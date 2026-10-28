"""Assignment-aware Regional Finance routing, using the existing approval and budget gate."""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...core import audit
from ...core.roles import REGIONAL_FINANCE, FHI360_FINANCE, CSO_FINANCE
from ...core.security import require_roles
from ...db.session import get_db
from ...models import Cadre, Facility, PaymentClaim, PayPeriod, Region, Staff, StaffAssignment, WorkLog
from ...services import finance_gate, worklog_workflow as wf
from ...services.v22_scope import record_condition, regions_for

router = APIRouter()


class ChannelIn(BaseModel):
    claim_id: Optional[int] = Field(default=None, gt=0)
    work_log_id: Optional[int] = Field(default=None, gt=0)
    target_payor_id: int = Field(gt=0)
    expected_version: Optional[int] = Field(default=None, ge=0)
    review_confirmed: bool = False
    review_type: Literal["SERVICES", "PAYROLL"]
    comment: Optional[str] = Field(default=None, max_length=2000)


def _visible(db, current):
    return db.query(WorkLog).filter(
        WorkLog.workflow_version >= 2,
        record_condition(current, WorkLog.assignment_id, WorkLog.cadre_id),
        WorkLog.staff_id != current.staff_id,
    )


def _log(db, current, log_id, lock=False):
    query = _visible(db, current).filter(WorkLog.id == log_id)
    if lock:
        query = query.with_for_update()
    log = query.first()
    if not log:
        raise HTTPException(404, "Work log not found in your Regional Finance scope")
    return log


def _payors(db, log):
    try:
        return {"eligible_payors": [{"id": owner.id, "name": owner.name, "type": owner.type}
                                   for owner in finance_gate.eligible_payors(db, log)], "routing_exception": None}
    except HTTPException as error:
        if error.status_code != 422:
            raise
        return {"eligible_payors": [], "routing_exception": error.detail}


@router.get("/monthly-summary")
def monthly_summary(
    month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    region_id: Optional[int] = Query(default=None, gt=0),
    work_type: Literal["SERVICES", "PAYROLL"] = "PAYROLL",
    db: Session = Depends(get_db),
    current=Depends(require_roles(REGIONAL_FINANCE, FHI360_FINANCE, CSO_FINANCE)),
):
    from ...services.finance_reports import monthly_summary as report
    return report(db, current, month, region_id, work_type)


@router.get("/regions")
def regions(db: Session = Depends(get_db), current=Depends(require_roles(REGIONAL_FINANCE, FHI360_FINANCE, CSO_FINANCE))):
    query = db.query(Region)
    if not current.unrestricted:
        query = query.filter(Region.id.in_(regions_for(current)))
    return [{"id": region.id, "name": region.name} for region in query.order_by(Region.name)]


@router.get("/payors")
def payors(work_log_id: int = Query(gt=0), db: Session = Depends(get_db), current=Depends(require_roles(REGIONAL_FINANCE))):
    log = _log(db, current, work_log_id)
    return {"work_log_id": log.id, **_payors(db, log)}


@router.get("/pending-routing")
def pending_routing(
    region_id: Optional[int] = Query(default=None, gt=0),
    work_type: Optional[Literal["SERVICES", "PAYROLL"]] = None,
    stage: Optional[Literal["PENDING_FINANCE_REVIEW", "FINANCE_REVIEWED", "BUDGET_HOLD"]] = None,
    db: Session = Depends(get_db), current=Depends(require_roles(REGIONAL_FINANCE)),
):
    query = _visible(db, current).filter(WorkLog.work_type == "SERVICES", WorkLog.status.in_([wf.PENDING_FINANCE, wf.FINANCE_REVIEWED, wf.BUDGET_HOLD]))
    if stage:
        query = query.filter(WorkLog.status == stage)
    if region_id:
        query = query.filter(WorkLog.assignment_id.in_(db.query(StaffAssignment.id).filter(StaffAssignment.region_id == region_id)))
    if work_type:
        query = query.filter(WorkLog.work_type == work_type)
    rows = []
    for log in query.order_by(WorkLog.status_changed_at, WorkLog.id):
        assignment = db.get(StaffAssignment, log.assignment_id)
        staff, cadre = db.get(Staff, log.staff_id), db.get(Cadre, log.cadre_id)
        facility = db.get(Facility, assignment.facility_id) if assignment.facility_id else None
        region, period = db.get(Region, assignment.region_id), db.get(PayPeriod, log.period_id)
        claim = db.query(PaymentClaim).filter(PaymentClaim.work_log_id == log.id, PaymentClaim.status != "CANCELLED").first()
        snapshot = log.finance_snapshot or {}
        amount = claim.amount if claim else snapshot.get("total")
        currency = claim.currency if claim else snapshot.get("currency")
        review_required = log.status == wf.PENDING_FINANCE
        rows.append({
            "work_log_id": log.id, "claim_id": claim.id if claim else None,
            "workflow_version": log.workflow_version, "work_type": log.work_type,
            "provider_name": staff.legal_name, "cadre_id": cadre.id, "cadre_code": cadre.code, "cadre_name": cadre.name,
            "facility_id": facility.id if facility else None, "facility_name": facility.name if facility else None,
            "region_id": region.id, "region_name": region.name, "period_label": wf.period_label(period),
            "status": log.status, "amount": str(amount) if amount is not None else None, "currency": currency,
            "finance_review_required": review_required,
            "next_action": "REVIEW_AMOUNT" if review_required else "RESOLVE_BUDGET_HOLD" if log.status == wf.BUDGET_HOLD else "CHANNEL",
            **_payors(db, log),
        })
    return rows


@router.post("/channel")
def channel(body: ChannelIn, db: Session = Depends(get_db), current=Depends(require_roles(REGIONAL_FINANCE))):
    log_id = body.work_log_id
    if body.claim_id:
        claim = db.query(PaymentClaim).filter(PaymentClaim.id == body.claim_id, PaymentClaim.workflow_version >= 2,
                                             PaymentClaim.status != "CANCELLED").first()
        if not claim or not claim.work_log_id:
            raise HTTPException(404, "Claim not found")
        # Check the linked log's scope before revealing any identity mismatch.
        _log(db, current, claim.work_log_id)
        if log_id and log_id != claim.work_log_id:
            raise HTTPException(422, "Claim and work log do not refer to the same record")
        log_id = claim.work_log_id
    if not log_id:
        raise HTTPException(422, "Provide claim_id or work_log_id")
    log = _log(db, current, log_id, lock=True)
    if log.work_type == "PAYROLL":
        raise HTTPException(409, "Payroll is report-only; no finance approval or payment channel is required.")
    if log.status not in {wf.FINANCE_REVIEWED, wf.BUDGET_HOLD} or not log.finance_snapshot:
        raise HTTPException(409, "The amount must be reviewed by Regional Finance before channeling")
    action = "release" if log.status == wf.BUDGET_HOLD else ("route_fhi360" if log.work_type == "SERVICES" else "route_cso")
    if not body.review_confirmed or body.review_type != log.work_type:
        raise HTTPException(422, "Confirm review of the correct Services or Payroll log before channeling")
    if body.target_payor_id not in {owner.id for owner in finance_gate.eligible_payors(db, log)}:
        raise HTTPException(422, "The selected payor does not match this provider's assigned payment channel")
    wf.transition(db, current, log, action, body.comment,
                  {"target_payor_id": body.target_payor_id, "review_confirmed": True, "review_type": body.review_type},
                  body.expected_version)
    claim = db.query(PaymentClaim).filter(PaymentClaim.work_log_id == log.id, PaymentClaim.status != "CANCELLED").one()
    owner = finance_gate.eligible_payors(db, log)[0]
    result = {
        "work_log_id": log.id, "claim_id": claim.id, "status": log.status, "claim_status": claim.status,
        "payor_id": owner.id, "payor_name": owner.name, "channel": log.finance_snapshot["channel"],
        "amount": str(claim.amount), "currency": claim.currency,
    }
    audit.record(db, current, "payment_claim", claim.id, "finance_channel", after=result, reason=body.comment)
    db.commit()
    return result
