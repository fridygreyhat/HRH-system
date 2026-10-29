"""CSO-owned payroll exports are read-only instructions for external payment."""
import csv
import io
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ...core import audit as system_audit
from ...core.roles import CSO_FINANCE
from ...core.security import CurrentUser, require_roles
from ...core.serialize import to_dict
from ...db.session import get_db
from ...models import BudgetLine, Organization, PayPeriod, PaymentClaim, Staff, StaffAssignment
from ...services import batches as bt, budgets as bg, payments as pay
from ...services import claims as cl
from ...services.provider_payment_details import details
from ...services.scope import claim_visibility
from .provider_payment_details import private_response

router = APIRouter(dependencies=[Depends(private_response)])


def organization(db, current, cso_id):
    org = db.query(Organization).filter(
        Organization.id == cso_id, Organization.id.in_(current.scope_values("organization_id")),
        Organization.type == "CSO", Organization.is_active.is_(True),
    ).first()
    if org is None:
        raise HTTPException(404, "Assigned CSO not found")
    return org


@router.get("/organizations")
def organizations(db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(CSO_FINANCE))):
    return [{"id": org.id, "name": org.name} for org in db.query(Organization).filter(
        Organization.id.in_(current.scope_values("organization_id")),
        Organization.type == "CSO", Organization.is_active.is_(True),
    ).order_by(Organization.name)]


@router.get("/pay-periods")
def periods(db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(CSO_FINANCE))):
    from ...services.v22_scope import regions_for
    return [to_dict(period) for period in db.query(PayPeriod).filter(
        PayPeriod.status != "ARCHIVED",
        or_(PayPeriod.region_id.is_(None), PayPeriod.region_id.in_(regions_for(current))),
    ).order_by(PayPeriod.start_date.desc(), PayPeriod.id.desc())]


def scoped_claims(db, current, cso_id):
    return db.query(PaymentClaim).filter(
        PaymentClaim.executor_org_id == cso_id, claim_visibility(current), bt.finance_claim_condition(current),
    )


@router.get("/dashboard/{cso_id}")
def dashboard(cso_id: int, db: Session = Depends(get_db),
              current: CurrentUser = Depends(require_roles(CSO_FINANCE))):
    org = organization(db, current, cso_id)
    from .budgets import _visibility
    lines = db.query(BudgetLine).filter(BudgetLine.organization_id == org.id, _visibility(current)).all()
    currencies = {}
    for line in lines:
        total = currencies.setdefault(line.currency, {
            "currency": line.currency, "allocated_amount": Decimal(0), "estimated_amount": Decimal(0),
            "committed_amount": Decimal(0), "spent_amount": Decimal(0), "available_amount": Decimal(0),
        })
        for key in ("allocated_amount", "committed_amount", "spent_amount"):
            total[key] += getattr(line, key)
        total["available_amount"] += bg.available(line)
        if total["estimated_amount"] is not None:
            total["estimated_amount"] = (total["estimated_amount"] + line.estimated_amount
                                         if line.estimated_amount is not None else None)
    pending = scoped_claims(db, current, org.id).filter(
        PaymentClaim.status.in_((cl.READY, cl.EXPORTED, cl.HANDED_OFF)),
        PaymentClaim.payment_status.notin_(("PAID", "RECONCILED")),
    ).all()
    return {
        "organization_id": org.id, "organization_name": org.name,
        "currencies": list(currencies.values()),
        "pending_payroll_count": sum(c.work_type == "PAYROLL" or c.route_code == "B" for c in pending),
        "pending_community_count": sum(c.route_code == "C" for c in pending),
    }


def spreadsheet_text(value):
    """Keep user-controlled text from becoming a spreadsheet formula."""
    value = str(value or "")
    return "'" + value if value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r", "\n")) else value


@router.get("/export-payroll")
def export_payroll(cso_id: int, period_id: int, region_id: int | None = None,
                   db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(CSO_FINANCE))):
    org = organization(db, current, cso_id)
    if db.get(PayPeriod, period_id) is None:
        raise HTTPException(422, "Choose a valid pay period")
    claims = scoped_claims(db, current, org.id).filter(
        PaymentClaim.period_id == period_id,
        or_(PaymentClaim.work_type == "PAYROLL",
            (PaymentClaim.workflow_version == 1) & (PaymentClaim.route_code == "B")),
        PaymentClaim.status.in_((cl.READY, cl.EXPORTED, cl.HANDED_OFF)),
        PaymentClaim.payment_status.in_(("NOT_STARTED", "PENDING", "FAILED")),
    ).order_by(PaymentClaim.id).all()
    rows = []
    for claim in claims:
        assignment = db.get(StaffAssignment, claim.assignment_id) if claim.assignment_id else None
        if region_id is not None and (assignment is None or assignment.region_id != region_id):
            continue
        if pay.executor_check(current, claim) is not None or pay.payable_check(db, claim) is not None:
            continue
        if pay.paid_total(db, claim.id) > 0:
            continue
        staff = db.get(Staff, claim.staff_id)
        bank = details(staff)
        if not all(bank[key] for key in ("bank_name", "bank_account_number", "bank_branch")):
            raise HTTPException(422, f"Payroll export blocked: provider #{staff.id} must complete bank name, account number and branch")
        rows.append({
            "claim_id": claim.id, "staff_id": staff.id, "provider_name": spreadsheet_text(staff.legal_name),
            "bank_name": spreadsheet_text(bank["bank_name"]), "bank_account_number": bank["bank_account_number"],
            "bank_branch": spreadsheet_text(bank["bank_branch"]),
            "validated_amount": str(claim.amount), "currency": claim.currency,
        })
    if not rows:
        raise HTTPException(422, "No approved, routed and unpaid payroll is available for this CSO and pay period")
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
    system_audit.record(db, current, "organization", org.id, "export_payroll",
                        after={"period_id": period_id, "region_id": region_id,
                               "claim_ids": [row["claim_id"] for row in rows], "row_count": len(rows)})
    db.commit()
    return Response(buffer.getvalue().encode("utf-8-sig"), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="cso-{org.id}-payroll-period-{period_id}.csv"',
                             "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
