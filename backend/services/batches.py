"""Payment batches: one per route + payor + executor. Exporting snapshots the exact content immutably.
New Payroll is report-only and never enters a batch.

Route A: FHI360 Finance exports → FHI360 records payments.
Route B: FHI360 Finance exports → hands off to the CSO → CSO acknowledges receipt → CSO records payments.
Route C: CSO Finance exports its own community claims → CSO records payments.

Central Finance may reverse an unpaid Route A batch. The snapshot stays as the record of
what was exported, but the file can no longer be downloaded and its claims return to READY.
"""
import csv
import io
from collections import defaultdict
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy import and_, or_, true, exists, select, case, cast, Integer
from sqlalchemy.orm import Session

from ..core import audit as system_audit
from ..core.roles import CSO_FINANCE, FHI360_FINANCE, OVERSIGHT
from ..core.security import CurrentUser
from ..core.serialize import spreadsheet_safe
from ..core.timeutil import local_today
from ..models import (
    BudgetLine,
    Cadre,
    ClaimCategory,
    ClaimComponent,
    Facility,
    Organization,
    PaymentClaim,
    PaymentProof,
    PaymentRecord,
    PayPeriod,
    PayrollBatch,
    Region,
    Staff,
    StaffAssignment,
    utcnow,
)
from . import claims as cl
from .scope import claim_visibility
from .v22_scope import record_condition
from ..models import WorkLog
from .worklog_workflow import period_label

EXPORTED, HANDED_OFF, RECEIVED, REVERSED = "EXPORTED", "HANDED_OFF", "RECEIVED", "REVERSED"

CSV_COLUMNS = [
    "batch", "claim_id", "staff_id", "staff_name", "phone", "cadre", "facility", "region", "period", "category",
    "budget_line", "route", "payor", "executor", "payment_method", "payment_provider", "payment_account",
    "components", "amount", "currency",
]


def finance_claim_condition(current: CurrentUser):
    direct_community = and_(PaymentClaim.workflow_version >= 2, PaymentClaim.work_type == "COMMUNITY",
                            PaymentClaim.route_code == "C", PaymentClaim.work_log_id.is_(None))
    cadre = case(
        (direct_community, cast(PaymentClaim.calculation_snapshot["cadre_id"].astext, Integer)),
        else_=select(WorkLog.cadre_id).where(WorkLog.id == PaymentClaim.work_log_id).scalar_subquery(),
    )
    return or_(
        PaymentClaim.workflow_version == 1,
        record_condition(current, PaymentClaim.assignment_id, cadre),
    )


def batch_visibility(current: CurrentUser):
    if OVERSIGHT in current.roles:
        return true()
    conditions = []
    if FHI360_FINANCE in current.roles:
        conditions.append(PayrollBatch.route_code.in_(("A", "B")))
    orgs = current.scope_values("organization_id")
    if CSO_FINANCE in current.roles and orgs:
        conditions.append(
            and_(PayrollBatch.executor_org_id.in_(orgs), or_(
                PayrollBatch.route_code == "C", PayrollBatch.status.in_((HANDED_OFF, RECEIVED)),
                exists().where(PaymentClaim.batch_id == PayrollBatch.id, PaymentClaim.workflow_version >= 2, PaymentClaim.work_type == "PAYROLL"),
            ))
        )
    visible = or_(*conditions) if conditions else PayrollBatch.id == -1
    # A reversed batch has no claims left to scope it by, but its snapshot still holds
    # names and account details, so it stays with the people who handled it.
    visible = and_(visible, or_(PayrollBatch.status != REVERSED, PayrollBatch.created_by == current.id,
                                PayrollBatch.reversed_by == current.id))
    # Do not expose a mixed-region export because just one of its claims is visible.
    return and_(visible, ~exists().where(
        PaymentClaim.batch_id == PayrollBatch.id, PaymentClaim.workflow_version >= 2,
        ~(claim_visibility(current) & finance_claim_condition(current)),
    ))


def ready_claims(db: Session, current: CurrentUser, route_code: str):
    """The claims a new batch of this route would take, or None when this person may not batch the route."""
    from ..models import PaymentRequestFormClaim
    role = cl.ROUTE_FINANCE_ROLE.get(route_code)
    if route_code == "B" and CSO_FINANCE in current.roles and FHI360_FINANCE not in current.roles:
        role = CSO_FINANCE
    if role is None or role not in current.roles:
        return None
    query = db.query(PaymentClaim).filter(PaymentClaim.status == cl.READY, PaymentClaim.route_code == route_code,
                                         claim_visibility(current), finance_claim_condition(current))
    query = query.filter(or_(PaymentClaim.workflow_version == 1, PaymentClaim.payment_status == "NOT_STARTED"))
    # A claim already on a PRF is paid from that PRF: a batch would be a second instruction for the same money.
    query = query.filter(PaymentClaim.id.notin_(select(PaymentRequestFormClaim.claim_id)))
    if route_code == "B" and not current.unrestricted and ((FHI360_FINANCE in current.roles) != (CSO_FINANCE in current.roles)):
        query = query.filter(PaymentClaim.workflow_version >= 2 if role == CSO_FINANCE else PaymentClaim.workflow_version == 1)
    if role == CSO_FINANCE:
        query = query.filter(PaymentClaim.executor_org_id.in_(current.scope_values("organization_id")))
    return query


def ready_counts(db: Session, current: CurrentUser) -> dict:
    """How many claims each route could batch now, so the page offers only a batch that can be made."""
    return {route: (query.count() if (query := ready_claims(db, current, route)) is not None else 0) for route in ("A", "B", "C")}


def create_batches(db: Session, current: CurrentUser, route_code: str) -> list[PayrollBatch]:
    role = cl.ROUTE_FINANCE_ROLE.get(route_code)
    if route_code == "B" and CSO_FINANCE in current.roles and FHI360_FINANCE not in current.roles:
        role = CSO_FINANCE
        if not db.query(PaymentClaim).filter(
            PaymentClaim.status == cl.READY, PaymentClaim.route_code == "B",
            PaymentClaim.workflow_version >= 2, PaymentClaim.payment_status == "NOT_STARTED",
            claim_visibility(current), finance_claim_condition(current),
        ).first():
            raise HTTPException(403, "Legacy Route B batches belong to FHI360; no new CSO-owned payroll is ready")
    if role is None:
        raise HTTPException(status_code=422, detail="Route must be A, B or C")
    if role not in current.roles:
        raise HTTPException(status_code=403, detail=f"Route {route_code} batches are prepared by {role}")
    claims = ready_claims(db, current, route_code).order_by(PaymentClaim.id).with_for_update().all()
    if not claims:
        raise HTTPException(status_code=409, detail=f"No Route {route_code} claims are marked ready for payment")

    groups: dict[tuple, list[PaymentClaim]] = defaultdict(list)
    for claim in claims:
        groups[(claim.payor_org_id, claim.executor_org_id, claim.currency)].append(claim)

    created = []
    for (payor_id, executor_id, currency), group in groups.items():
        batch = PayrollBatch(
            reference=f"TMP-{utcnow().timestamp()}",
            route_code=route_code,
            payor_org_id=payor_id,
            executor_org_id=executor_id,
            status=EXPORTED,
            currency=currency,
            created_by=current.id,
            export_snapshot={},
            export_csv="",
        )
        db.add(batch)
        db.flush()
        batch.reference = f"{route_code}-{local_today():%Y%m%d}-{batch.id:05d}"
        lines = [_line(db, batch, c) for c in group]
        batch.line_count = len(lines)
        batch.total_amount = sum((Decimal(l["amount"]) for l in lines), Decimal(0))
        batch.export_snapshot = jsonable_encoder({"reference": batch.reference, "exported_at": utcnow(), "lines": lines})
        batch.export_csv = _csv(lines)
        for claim in group:
            old, old_pay = claim.status, claim.payment_status
            claim.status = cl.EXPORTED
            claim.batch_id = batch.id
            if route_code in ("A", "C"):
                claim.payment_status = "PENDING"
            cl.audit(db, current, claim, "export", role, old, old_pay, f"Exported in batch {batch.reference}")
        system_audit.record(db, current, "payroll_batch", batch.id, "export", after={"reference": batch.reference, "lines": len(lines), "total": batch.total_amount})
        created.append(batch)
    db.flush()
    return created


def _line(db: Session, batch: PayrollBatch, claim: PaymentClaim) -> dict:
    from .provider_payment_details import recipient
    staff = db.get(Staff, claim.staff_id)
    destination = recipient(staff, claim)
    assignment = db.get(StaffAssignment, claim.assignment_id) if claim.assignment_id else None
    facility = db.get(Facility, assignment.facility_id) if assignment and assignment.facility_id else None
    components = db.query(ClaimComponent).filter(ClaimComponent.claim_id == claim.id).all()
    line = db.get(BudgetLine, claim.budget_line_id) if claim.budget_line_id else None
    org = lambda i: (db.get(Organization, i).name if i else "")  # noqa: E731
    return {
        "batch": batch.reference,
        "claim_id": claim.id,
        "staff_id": staff.id,
        "staff_name": staff.legal_name,
        "phone": staff.verified_phone,
        "cadre": db.get(Cadre, staff.cadre_id).code,
        "facility": facility.name if facility else "",
        "region": db.get(Region, assignment.region_id).name if assignment else "",
        "period": period_label(db.get(PayPeriod, claim.period_id)),
        "category": db.get(ClaimCategory, claim.category_id).name,
        "budget_line": line.code if line else "",
        "route": claim.route_code,
        "payor": org(claim.payor_org_id),
        "executor": org(claim.executor_org_id),
        "payment_method": destination["payment_method"] or "",
        "payment_provider": destination["payment_provider"] or "",
        "payment_account": destination["payment_account"] or "",
        "components": "; ".join(f"{c.component_name}: {c.units} x {c.rate} = {c.amount}" for c in components),
        "amount": str(claim.amount),
        "currency": claim.currency,
    }


def _csv(lines: list[dict]) -> str:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=CSV_COLUMNS)
    writer.writeheader()
    writer.writerows({key: spreadsheet_safe(value) for key, value in line.items()} for line in lines)
    return buffer.getvalue()


def to_xlsx(batch: PayrollBatch, lines=None) -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    write_details(wb.active, batch, lines)
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def write_details(ws, batch: PayrollBatch, lines=None):
    """The batch's full line list: claim, route, payor, budget line, payment destination and amount."""
    from openpyxl.styles import Font
    ws.title = batch.reference[:31]
    ws.append(CSV_COLUMNS)
    for cell in ws[1]:
        cell.font = Font(bold=True)
    for line in lines if lines is not None else batch.export_snapshot["lines"]:
        row = [spreadsheet_safe(line.get(c, "")) for c in CSV_COLUMNS]
        row[CSV_COLUMNS.index("amount")] = float(line["amount"])
        ws.append(row)
    ws.append([])
    ws.append(["TOTAL"] + [""] * (len(CSV_COLUMNS) - 3) + [float(batch.total_amount), batch.currency])


def hand_off(db: Session, current: CurrentUser, batch: PayrollBatch) -> PayrollBatch:
    if db.query(PaymentClaim).filter(PaymentClaim.batch_id == batch.id, PaymentClaim.workflow_version >= 2).first():
        raise HTTPException(409, "New payroll is already CSO-owned; the legacy FHI360 handoff does not apply")
    if batch.route_code != "B" or batch.status != EXPORTED:
        raise HTTPException(status_code=409, detail="Only exported Route B batches can be handed off to the CSO")
    if FHI360_FINANCE not in current.roles:
        raise HTTPException(status_code=403, detail="Handoff is performed by FHI360 Finance")
    batch.status, batch.handed_off_by, batch.handed_off_at = HANDED_OFF, current.id, utcnow()
    for claim in db.query(PaymentClaim).filter(PaymentClaim.batch_id == batch.id).with_for_update():
        old, old_pay = claim.status, claim.payment_status
        claim.status = cl.HANDED_OFF
        cl.audit(db, current, claim, "hand_off", FHI360_FINANCE, old, old_pay, f"Batch {batch.reference} handed off to CSO")
    system_audit.record(db, current, "payroll_batch", batch.id, "hand_off")
    return batch


def receive(db: Session, current: CurrentUser, batch: PayrollBatch) -> PayrollBatch:
    if batch.route_code != "B" or batch.status != HANDED_OFF:
        raise HTTPException(status_code=409, detail="Only handed-off Route B batches can be received")
    if CSO_FINANCE not in current.roles or batch.executor_org_id not in current.scope_values("organization_id"):
        raise HTTPException(status_code=403, detail="Receipt is acknowledged by the assigned CSO's finance staff")
    batch.status, batch.received_by, batch.received_at = RECEIVED, current.id, utcnow()
    for claim in db.query(PaymentClaim).filter(PaymentClaim.batch_id == batch.id).with_for_update():
        old_pay = claim.payment_status
        claim.payment_status = "PENDING"
        cl.audit(db, current, claim, "cso_receive", CSO_FINANCE, claim.status, old_pay, f"CSO received batch {batch.reference}")
    system_audit.record(db, current, "payroll_batch", batch.id, "cso_receive")
    return batch


def reverse_block(db: Session, batch: PayrollBatch, claims: list[PaymentClaim]) -> Optional[str]:
    """Why this batch cannot be reversed. Any payment or proof may mean money has moved."""
    if batch.route_code != "A" or batch.status != EXPORTED:
        return "Only exported Route A batches can be reversed"
    if not claims:
        return "This batch has no claims to reverse"
    ids = [claim.id for claim in claims]
    # A failed attempt moved no money, so it must not freeze the whole batch.
    moved = (db.query(PaymentRecord.claim_id).filter(PaymentRecord.claim_id.in_(ids), PaymentRecord.status != "FAILED").first()
             or db.query(PaymentProof.claim_id).filter(PaymentProof.claim_id.in_(ids)).first())
    if moved:
        return f"Claim #{moved[0]} has a payment or proof recorded, so this batch cannot be reversed"
    stuck = next((claim for claim in claims if claim.status != cl.EXPORTED or claim.payment_status not in ("PENDING", "FAILED")), None)
    return f"Claim #{stuck.id} has moved on since export, so this batch cannot be reversed" if stuck else None


def reverse(db: Session, current: CurrentUser, batch: PayrollBatch, reason: str) -> PayrollBatch:
    if FHI360_FINANCE not in current.roles:
        raise HTTPException(status_code=403, detail="Batches are reversed by Central Finance")
    reason = reason.strip()
    if not reason:
        raise HTTPException(status_code=422, detail="A reason is required to reverse a batch")
    # Payment and proof uploads lock the claim first, so check them only after these locks.
    claims = (db.query(PaymentClaim).filter(PaymentClaim.batch_id == batch.id).order_by(PaymentClaim.id)
              .with_for_update().populate_existing().all())
    block = reverse_block(db, batch, claims)
    if block:
        raise HTTPException(status_code=409, detail=block)
    batch.status, batch.reversed_by, batch.reversed_at, batch.reversal_reason = REVERSED, current.id, utcnow(), reason
    for claim in claims:
        old, old_pay = claim.status, claim.payment_status
        claim.status, claim.payment_status, claim.batch_id = cl.READY, "NOT_STARTED", None
        cl.audit(db, current, claim, "batch_reversed", FHI360_FINANCE, old, old_pay, reason,
                 details={"batch_id": batch.id, "batch_reference": batch.reference})
    system_audit.record(db, current, "payroll_batch", batch.id, "reverse", reason=reason,
                        after={"reference": batch.reference, "claim_ids": [claim.id for claim in claims]})
    return batch
