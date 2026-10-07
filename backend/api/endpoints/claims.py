from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...core import audit as system_audit
from ...core.roles import CSO_FINANCE, FHI360_FINANCE
from ...core.security import CurrentUser, get_current_user, require_roles
from ...core.serialize import to_dict
from ...db.session import get_db
from ...models import (
    BudgetLine,
    ClaimAudit,
    ClaimCategory,
    ClaimComponent,
    Organization,
    PaymentClaim,
    PaymentProof,
    PaymentRecord,
    PayPeriod,
    PayrollBatch,
    Staff,
    StaffAssignment,
    User,
    WorkLog,
)
from ...services import claims as cl
from ...services import payments as pay
from ...services.scope import assignment_for_period, claim_visibility, worklog_visibility
from ...services.trace import trace_claim
from ...services.worklog_workflow import APPROVED as LOG_APPROVED, period_label

router = APIRouter()


class ClaimCreate(BaseModel):
    category_id: int
    work_log_id: Optional[int] = None
    # Only for categories that do not require an HRH work log (e.g. Route C community services):
    staff_id: Optional[int] = None
    period_id: Optional[int] = None
    evidence_text: Optional[str] = Field(default=None, max_length=2000)
    declared_units: Optional[dict[str, float]] = None


class ActionIn(BaseModel):
    comment: Optional[str] = Field(default=None, max_length=2000)


class PaymentIn(BaseModel):
    amount: Decimal = Field(gt=0)
    payment_reference: str = Field(min_length=2, max_length=255)
    payment_date: date
    status: str = "PAID"
    payment_method: Optional[str] = Field(default=None, max_length=50)


def _get(db: Session, current: CurrentUser, claim_id: int, lock: bool = False) -> PaymentClaim:
    query = db.query(PaymentClaim).filter(PaymentClaim.id == claim_id, claim_visibility(current))
    claim = (query.with_for_update(of=PaymentClaim) if lock else query).first()
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    return claim


def _org(db, id_):
    return db.get(Organization, id_).name if id_ else None


def _summary(db: Session, claim: PaymentClaim) -> dict:
    staff = db.get(Staff, claim.staff_id)
    batch = db.get(PayrollBatch, claim.batch_id) if claim.batch_id else None
    return {
        **to_dict(claim, exclude=("calculation_snapshot",)),
        "staff_name": staff.legal_name,
        "category_name": db.get(ClaimCategory, claim.category_id).name,
        "period_label": period_label(db.get(PayPeriod, claim.period_id)),
        "payor_name": _org(db, claim.payor_org_id),
        "executor_name": _org(db, claim.executor_org_id),
        "batch_reference": batch.reference if batch else None,
        "amount_paid": pay.paid_total(db, claim.id),
    }


def _detail(db: Session, current: CurrentUser, claim: PaymentClaim) -> dict:
    line = db.get(BudgetLine, claim.budget_line_id) if claim.budget_line_id else None
    audit_rows = (
        db.query(ClaimAudit, User.full_name)
        .outerjoin(User, User.id == ClaimAudit.actor_id)
        .filter(ClaimAudit.claim_id == claim.id)
        .order_by(ClaimAudit.timestamp, ClaimAudit.id)
        .all()
    )
    finance_view = current.has_any(FHI360_FINANCE, CSO_FINANCE)
    return {
        **_summary(db, claim),
        "calculation_snapshot": claim.calculation_snapshot,
        "budget_line": {"id": line.id, "code": line.code, "name": line.name} if line else None,
        "components": [to_dict(c) for c in db.query(ClaimComponent).filter(ClaimComponent.claim_id == claim.id)],
        "payments": [to_dict(p) for p in db.query(PaymentRecord).filter(PaymentRecord.claim_id == claim.id).order_by(PaymentRecord.id)] if finance_view else [],
        "proofs": [to_dict(p, exclude=("storage_key",)) for p in db.query(PaymentProof).filter(PaymentProof.claim_id == claim.id)] if finance_view else [],
        "audit": [{**to_dict(a), "actor_name": name} for a, name in audit_rows],
        "available_actions": cl.available_actions(db, current, claim),
        "payment_actions": pay.payment_actions(db, current, claim),
    }


@router.get("/statuses")
def statuses():
    return {"claim_statuses": cl.CLAIM_STATUSES, "payment_statuses": cl.PAYMENT_STATUSES}


@router.get("")
def list_claims(
    status: Optional[str] = None,
    payment_status: Optional[str] = None,
    route: Optional[str] = None,
    period_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    query = db.query(PaymentClaim).filter(claim_visibility(current))
    for column, value in ((PaymentClaim.status, status), (PaymentClaim.payment_status, payment_status), (PaymentClaim.route_code, route), (PaymentClaim.period_id, period_id)):
        if value:
            query = query.filter(column == value)
    return [_summary(db, c) for c in query.order_by(PaymentClaim.updated_at.desc()).limit(500)]


@router.get("/eligible-worklogs")
def eligible_worklogs(db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(FHI360_FINANCE, CSO_FINANCE))):
    logs = db.query(WorkLog).filter(WorkLog.status == LOG_APPROVED, worklog_visibility(current)).order_by(WorkLog.approved_at.desc()).limit(500).all()
    live = {}
    for c in db.query(PaymentClaim).filter(PaymentClaim.work_log_id.in_([l.id for l in logs]), PaymentClaim.status != cl.CANCELLED):
        live.setdefault(c.work_log_id, []).append(c.category_id)
    return [
        {
            "id": log.id,
            "staff_name": db.get(Staff, log.staff_id).legal_name,
            "period_label": period_label(db.get(PayPeriod, log.period_id)),
            "approved_at": log.approved_at,
            "claimed_category_ids": live.get(log.id, []),
        }
        for log in logs
    ]


def _context(db: Session, current: CurrentUser, body: ClaimCreate):
    category = db.get(ClaimCategory, body.category_id)
    if not category or not category.is_active:
        raise HTTPException(status_code=404, detail="Claim category not found")
    if body.work_log_id:
        log = db.query(WorkLog).filter(WorkLog.id == body.work_log_id, worklog_visibility(current)).first()
        if not log:
            raise HTTPException(status_code=404, detail="Work log not found")
        if log.status != LOG_APPROVED:
            raise HTTPException(status_code=409, detail=f"The work log must be APPROVED (it is {log.status})")
        return category, db.get(Staff, log.staff_id), db.get(PayPeriod, log.period_id), db.get(StaffAssignment, log.assignment_id), log
    if category.requires_work_log:
        raise HTTPException(status_code=422, detail=f"'{category.name}' claims must be linked to an approved work log")
    if not (body.staff_id and body.period_id):
        raise HTTPException(status_code=422, detail="staff_id and period_id are required for claims without a work log")
    staff, period = db.get(Staff, body.staff_id), db.get(PayPeriod, body.period_id)
    if not staff or not period:
        raise HTTPException(status_code=404, detail="Staff member or period not found")
    if not (body.evidence_text or "").strip():
        raise HTTPException(status_code=422, detail="Evidence is required for claims without a work log")
    return category, staff, period, assignment_for_period(db, staff.id, period), None


@router.post("/preview")
def preview(body: ClaimCreate, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(FHI360_FINANCE, CSO_FINANCE))):
    """Show route, payor, executor, formula and components before anything is created."""
    category, staff, period, assignment, log = _context(db, current, body)
    r = cl.resolve(db, category, staff, period, assignment, log, body.declared_units)
    return {
        "route_code": r.route_code,
        "payor_name": _org(db, r.payor_org_id),
        "executor_name": _org(db, r.executor_org_id),
        "budget_line_id": r.budget_line_id,
        "components": r.components,
        "amount": r.amount,
        "exceptions": r.exceptions,
    }


@router.post("", status_code=201)
def create_claim(body: ClaimCreate, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(FHI360_FINANCE, CSO_FINANCE))):
    category, staff, period, assignment, log = _context(db, current, body)
    if current.staff_id == staff.id:
        raise HTTPException(status_code=403, detail="You cannot prepare a claim for yourself")
    r = cl.resolve(db, category, staff, period, assignment, log, body.declared_units)
    role = cl.ROUTE_FINANCE_ROLE.get(r.route_code or "")
    if role and role not in current.roles:
        raise HTTPException(status_code=403, detail=f"Route {r.route_code} claims are prepared by {role}")
    if role == CSO_FINANCE and r.executor_org_id not in current.scope_values("organization_id"):
        raise HTTPException(status_code=403, detail="This staff member is assigned to another CSO")

    claim = PaymentClaim(
        work_log_id=log.id if log else None,
        staff_id=staff.id,
        category_id=category.id,
        period_id=period.id,
        assignment_id=assignment.id if assignment else None,
        community_area_id=assignment.community_area_id if assignment else None,
        evidence_text=body.evidence_text,
        declared_units=body.declared_units,
        created_by=current.id,
    )
    db.add(claim)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A live claim already exists for this staff member, category and period")
    cl.apply_resolution(db, claim, r)
    cl.audit(db, current, claim, "create", role, None, None, "; ".join(r.exceptions) or None)
    db.commit()
    return _detail(db, current, claim)


@router.get("/{claim_id}")
def get_claim(claim_id: int, db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)):
    return _detail(db, current, _get(db, current, claim_id))


@router.get("/{claim_id}/trace")
def trace(claim_id: int, db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)):
    """Lineage of a claim: components → approved rate rules → the daily entries and values that produced them →
    the provider-confirmed version → approvals → payments. Same access rules as the claim itself."""
    return trace_claim(db, current, _get(db, current, claim_id))


@router.post("/{claim_id}/actions/{action}")
def perform_action(claim_id: int, action: str, body: ActionIn = ActionIn(), db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)):
    claim = _get(db, current, claim_id, lock=True)
    if action == "confirm_paid":
        pay.confirm_paid(db, current, claim)
    elif action == "reconcile":
        pay.reconcile(db, current, claim, body.comment)
    else:
        cl.perform(db, current, claim, action, body.comment)
    db.commit()
    return _detail(db, current, claim)


@router.post("/{claim_id}/payments", status_code=201)
def record_payment(claim_id: int, body: PaymentIn, db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)):
    claim = _get(db, current, claim_id, lock=True)
    pay.record_payment(db, current, claim, body.amount, body.payment_reference.strip(), body.payment_date, body.status, body.payment_method)
    db.commit()
    return _detail(db, current, claim)


@router.post("/{claim_id}/proofs", status_code=201)
async def upload_proof(
    claim_id: int,
    file: UploadFile = File(...),
    payment_record_id: Optional[int] = Form(default=None),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    claim = _get(db, current, claim_id, lock=True)
    await pay.store_proof(db, current, claim, file, payment_record_id)
    db.commit()
    return _detail(db, current, claim)


@router.get("/{claim_id}/proofs/{proof_id}")
def download_proof(claim_id: int, proof_id: int, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(FHI360_FINANCE, CSO_FINANCE))):
    claim = _get(db, current, claim_id)
    proof = db.query(PaymentProof).filter(PaymentProof.id == proof_id, PaymentProof.claim_id == claim.id).first()
    if not proof:
        raise HTTPException(status_code=404, detail="Proof not found")
    system_audit.record(db, current, "payment_proof", proof.id, "download")
    db.commit()
    return FileResponse(pay.proof_path(proof), media_type=proof.content_type, filename=proof.original_filename)
