"""Deduct once on routing; payment recording must not deduct a second time."""
from collections import defaultdict
from datetime import date
from decimal import Decimal
from fastapi import HTTPException
from sqlalchemy.orm import defer

from ..models import MonthlyServiceBudget, MonthlyServiceBudgetCharge, PaymentClaim, PaymentProof, Staff, StaffAssignment, utcnow
from ..core import audit
from ..core.period_dates import pay_month_of
from .v22_scope import regions_for


def visible(db, current):
    query = db.query(MonthlyServiceBudget).options(defer(MonthlyServiceBudget.document_data))
    return query if current.unrestricted else query.filter(MonthlyServiceBudget.region_id.in_(regions_for(current)))


def summary(row):
    return {"id": row.id, "region_id": row.region_id, "month": row.month, "currency": row.currency,
            "allocated_amount": str(row.allocated_amount), "deducted_amount": str(row.deducted_amount),
            "remaining_amount": str(row.allocated_amount - row.deducted_amount),
            "document_name": row.document_name, "updated_at": row.updated_at}


def deductions(db, current, budget):
    """What reduced this budget, newest first. Amounts always show so the rows add
    up to the total; provider and service details need the claim's cadre scope."""
    from .claims import channel_scope_ok
    rows = (db.query(MonthlyServiceBudgetCharge, PaymentClaim, Staff)
            .join(PaymentClaim, PaymentClaim.id == MonthlyServiceBudgetCharge.claim_id)
            .join(Staff, Staff.id == PaymentClaim.staff_id)
            .filter(MonthlyServiceBudgetCharge.budget_id == budget.id)
            .order_by(MonthlyServiceBudgetCharge.created_at.desc(), MonthlyServiceBudgetCharge.id.desc()).all())
    result = []
    for charge, claim, staff in rows:
        item = {"id": charge.id, "amount": str(charge.amount), "deducted_at": charge.created_at,
                "restored_at": charge.released_at, "restricted": True,
                "claim_id": None, "claim_status": None, "payment_status": None, "proof_attached": False,
                "provider": None, "services": []}
        if channel_scope_ok(current, claim):
            lines = (claim.calculation_snapshot or {}).get("lines", [])
            item.update(restricted=False, claim_id=claim.id, claim_status=claim.status,
                        payment_status=claim.payment_status,
                        proof_attached=db.query(PaymentProof.id).filter_by(claim_id=claim.id).first() is not None,
                        provider=staff.legal_name,
                        services=[{"date": line["date"], "activity": line["activity"], "amount": line["amount"]}
                                  for line in lines
                                  if line["date"].startswith(budget.month) and Decimal(str(line["amount"])) > 0])
        result.append(item)
    return result


def validate_month(month):
    try:
        year, number = map(int, month.split("-"))
        date(year, number, 1)
        if not 2000 <= year <= 2100 or len(month) != 7:
            raise ValueError()
    except ValueError:
        raise HTTPException(422, "Choose a valid calendar month between 2000 and 2100.")


def deduct(db, current, claim):
    """Caller holds the claim lock; lock all month buckets in a stable order."""
    if claim.work_type != "SERVICES":
        return
    amounts = defaultdict(Decimal)
    for line in (claim.calculation_snapshot or {}).get("lines", []):
        try:
            day = date.fromisoformat(line["date"])
            amount = Decimal(str(line["amount"]))
        except (KeyError, ValueError, ArithmeticError):
            raise HTTPException(409, "Review the Services payment calculation before submitting.")
        if not amount.is_finite() or amount < 0:
            raise HTTPException(409, "The Services payment calculation has an invalid amount.")
        amounts[pay_month_of(day)] += amount
    if not amounts or sum(amounts.values()) != claim.amount:
        raise HTTPException(409, "The Services monthly breakdown does not match the claim. Review it again.")
    assignment = db.get(StaffAssignment, claim.assignment_id)
    if not assignment:
        raise HTTPException(409, "The Services claim has no regional assignment.")
    for month, amount in sorted(amounts.items()):
        if amount == 0:
            continue
        budget = (db.query(MonthlyServiceBudget).options(defer(MonthlyServiceBudget.document_data))
                  .filter_by(region_id=assignment.region_id, month=month, currency=claim.currency)
                  .with_for_update().populate_existing().first())
        if not budget:
            raise HTTPException(409, f"Enter the approved regional Services budget for {month} ({claim.currency}) before submitting to Central Finance.")
        previous = db.query(MonthlyServiceBudgetCharge).filter_by(budget_id=budget.id, claim_id=claim.id).first()
        if previous:
            if previous.released_at or previous.amount != amount:
                raise HTTPException(409, "This claim's budget deduction changed. Cancel and prepare it again.")
            continue
        remaining = budget.allocated_amount - budget.deducted_amount
        if amount > remaining:
            raise HTTPException(409, f"Insufficient regional Services budget for {month}: {claim.currency} {remaining:,.2f} available; {amount:,.2f} required.")
        budget.deducted_amount += amount
        db.add(MonthlyServiceBudgetCharge(budget_id=budget.id, claim_id=claim.id,
                                         amount=amount, created_by=current.id))
        audit.record(db, current, "monthly_service_budget", budget.id, "submission_deduction",
                     after={"claim_id": claim.id, "month": month, "amount": str(amount),
                            "deducted_amount": str(budget.deducted_amount)})
    db.flush()


def release(db, current, claim):
    """Only the existing unpaid-claim cancellation flow may restore a deduction."""
    charges = (db.query(MonthlyServiceBudgetCharge).join(MonthlyServiceBudget)
               .filter(MonthlyServiceBudgetCharge.claim_id == claim.id,
                       MonthlyServiceBudgetCharge.released_at.is_(None))
               .order_by(MonthlyServiceBudget.month, MonthlyServiceBudget.currency, MonthlyServiceBudget.region_id).all())
    if charges:
        from .payments import paid_total
        if paid_total(db, claim.id) > 0:
            raise HTTPException(409, "A Services claim with recorded payments cannot restore its budget deduction.")
    for charge in charges:
        budget = (db.query(MonthlyServiceBudget).options(defer(MonthlyServiceBudget.document_data))
                  .filter_by(id=charge.budget_id).with_for_update().populate_existing().one())
        budget.deducted_amount -= charge.amount
        charge.released_at = utcnow()
        audit.record(db, current, "monthly_service_budget", budget.id, "cancelled_submission_refund",
                     after={"claim_id": claim.id, "amount": str(charge.amount)})
