"""Payroll batches: one per route + payor + executor. Exporting snapshots the exact content immutably.

Route A: FHI360 Finance exports → FHI360 records payments.
Route B: FHI360 Finance exports → hands off to the CSO → CSO acknowledges receipt → CSO records payments.
Route C: CSO Finance exports its own community claims → CSO records payments.
"""
import csv
import io
from collections import defaultdict
from decimal import Decimal

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy import and_, or_, true
from sqlalchemy.orm import Session

from ..core import audit as system_audit
from ..core.roles import CSO_FINANCE, FHI360_FINANCE, OVERSIGHT
from ..core.security import CurrentUser
from ..core.timeutil import local_today
from ..models import (
    BudgetLine,
    Cadre,
    ClaimCategory,
    ClaimComponent,
    Facility,
    Organization,
    PaymentClaim,
    PayPeriod,
    PayrollBatch,
    Region,
    Staff,
    StaffAssignment,
    utcnow,
)
from . import claims as cl
from .scope import claim_visibility
from .worklog_workflow import period_label

EXPORTED, HANDED_OFF, RECEIVED = "EXPORTED", "HANDED_OFF", "RECEIVED"

CSV_COLUMNS = [
    "batch", "claim_id", "staff_id", "staff_name", "phone", "cadre", "facility", "region", "period", "category",
    "budget_line", "route", "payor", "executor", "payment_method", "payment_provider", "payment_account",
    "components", "amount", "currency",
]


def batch_visibility(current: CurrentUser):
    if OVERSIGHT in current.roles:
        return true()
    conditions = []
    if FHI360_FINANCE in current.roles:
        conditions.append(PayrollBatch.route_code.in_(("A", "B")))
    orgs = current.scope_values("organization_id")
    if CSO_FINANCE in current.roles and orgs:
        conditions.append(
            and_(PayrollBatch.executor_org_id.in_(orgs), or_(PayrollBatch.route_code == "C", PayrollBatch.status.in_((HANDED_OFF, RECEIVED))))
        )
    return or_(*conditions) if conditions else PayrollBatch.id == -1


def create_batches(db: Session, current: CurrentUser, route_code: str) -> list[PayrollBatch]:
    role = cl.ROUTE_FINANCE_ROLE.get(route_code)
    if role is None:
        raise HTTPException(status_code=422, detail="Route must be A, B or C")
    if role not in current.roles:
        raise HTTPException(status_code=403, detail=f"Route {route_code} batches are prepared by {role}")
    query = db.query(PaymentClaim).filter(PaymentClaim.status == cl.READY, PaymentClaim.route_code == route_code, claim_visibility(current))
    if role == CSO_FINANCE:
        query = query.filter(PaymentClaim.executor_org_id.in_(current.scope_values("organization_id")))
    claims = query.order_by(PaymentClaim.id).with_for_update().all()
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
    staff = db.get(Staff, claim.staff_id)
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
        "payment_method": staff.payment_method or "",
        "payment_provider": staff.payment_provider or "",
        "payment_account": staff.payment_account or "",
        "components": "; ".join(f"{c.component_name}: {c.units} x {c.rate} = {c.amount}" for c in components),
        "amount": str(claim.amount),
        "currency": claim.currency,
    }


def _csv(lines: list[dict]) -> str:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=CSV_COLUMNS)
    writer.writeheader()
    writer.writerows(lines)
    return buffer.getvalue()


def to_xlsx(batch: PayrollBatch) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font

    wb = Workbook()
    ws = wb.active
    ws.title = batch.reference
    ws.append(CSV_COLUMNS)
    for cell in ws[1]:
        cell.font = Font(bold=True)
    for line in batch.export_snapshot["lines"]:
        row = [line.get(c, "") for c in CSV_COLUMNS]
        row[CSV_COLUMNS.index("amount")] = float(line["amount"])
        ws.append(row)
    ws.append([])
    ws.append(["TOTAL"] + [""] * (len(CSV_COLUMNS) - 3) + [float(batch.total_amount), batch.currency])
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def hand_off(db: Session, current: CurrentUser, batch: PayrollBatch) -> PayrollBatch:
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
