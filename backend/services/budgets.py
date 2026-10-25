"""Budget lines with transaction-safe commitments. Every change is written to the append-only ledger.

Rows are locked with SELECT ... FOR UPDATE, and a CHECK constraint (committed + spent <= allocated) is the
last line of defence, so concurrent approvals can never over-commit a line.
"""
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..models import BudgetLine, BudgetTransaction, ClaimCategory


def category_activity_type(category: ClaimCategory) -> Optional[str]:
    """Keep payment-rule detail separate from the two user-facing activity types."""
    if category.form_type == "SALARY":
        return "PAYROLL"
    if category.form_type in ("CHW_PNP", "HCP_PNP", "COORDINATION", "COMMUNITY_SERVICE"):
        return "SERVICES"
    return None


class InsufficientBudget(Exception):
    def __init__(self, line: BudgetLine, shortfall: Decimal):
        self.line = line
        self.shortfall = shortfall
        super().__init__(f"Budget line {line.code} short by {shortfall}")


def available(line: BudgetLine) -> Decimal:
    return line.allocated_amount - line.committed_amount - line.spent_amount


def lock(db: Session, line_id: int) -> BudgetLine:
    return db.query(BudgetLine).filter(BudgetLine.id == line_id).with_for_update().populate_existing().one()


def planning_status(line: BudgetLine) -> dict:
    exposure = line.committed_amount + line.spent_amount
    warning = line.estimated_amount is not None and exposure > 0 and exposure >= line.estimated_amount
    status = ("HARD_CAP_REACHED" if available(line) <= 0 else
              "NOT_SET" if line.estimated_amount is None else
              "ESTIMATE_REACHED" if warning else "WITHIN_ESTIMATE")
    return {"exposure_amount": exposure, "estimate_warning": warning, "budget_status": status}


def find_line(db: Session, category_id: int, period_id: int, organization_id: int, region_id: Optional[int], *, strict_region=False) -> Optional[BudgetLine]:
    """Most specific line for the category/period/owner: a region-specific line beats an all-region line."""
    query = (
        db.query(BudgetLine)
        .filter(
            BudgetLine.category_id == category_id,
            BudgetLine.period_id == period_id,
            BudgetLine.organization_id == organization_id,
            BudgetLine.region_id == region_id if strict_region else or_(BudgetLine.region_id.is_(None), BudgetLine.region_id == region_id),
        )
        .order_by(BudgetLine.region_id.is_(None))
    )
    if strict_region:
        rows = query.limit(2).all()
        if len(rows) > 1:
            raise HTTPException(422, "Multiple CSO budget lines match this region, category and pay period; resolve the ambiguous allocation before routing")
        return rows[0] if rows else None
    return query.first()


def _ledger(db: Session, line: BudgetLine, kind: str, amount: Decimal, actor_id, reason=None, claim_id=None, payment_record_id=None):
    db.add(
        BudgetTransaction(
            budget_line_id=line.id,
            claim_id=claim_id,
            payment_record_id=payment_record_id,
            kind=kind,
            amount=amount,
            actor_id=actor_id,
            reason=reason,
        )
    )


def commit(db: Session, line_id: int, amount: Decimal, claim_id: int, actor_id: int) -> BudgetLine:
    line = lock(db, line_id)
    if available(line) < amount:
        raise InsufficientBudget(line, amount - available(line))
    line.committed_amount += amount
    _ledger(db, line, "COMMIT", amount, actor_id, claim_id=claim_id)
    return line


def release(db: Session, line_id: int, amount: Decimal, claim_id: int, actor_id: int, reason: str) -> None:
    line = lock(db, line_id)
    line.committed_amount -= amount
    _ledger(db, line, "RELEASE", amount, actor_id, reason, claim_id=claim_id)


def spend(db: Session, line_id: int, amount: Decimal, claim_id: int, payment_record_id: int, actor_id: int) -> None:
    """Move a committed amount to spent (never double counts: the commitment shrinks by the same amount)."""
    line = lock(db, line_id)
    line.committed_amount -= amount
    line.spent_amount += amount
    _ledger(db, line, "SPEND", amount, actor_id, claim_id=claim_id, payment_record_id=payment_record_id)


def reallocate(db: Session, from_id: int, to_id: int, amount: Decimal, actor_id: int, reason: str) -> tuple[BudgetLine, BudgetLine]:
    if from_id == to_id:
        raise HTTPException(status_code=422, detail="Choose two different budget lines")
    # Lock in id order to avoid deadlocks between concurrent reallocations.
    first, second = sorted((from_id, to_id))
    locked = {first: lock(db, first), second: lock(db, second)}
    source, target = locked[from_id], locked[to_id]
    if source.organization_id != target.organization_id or source.currency != target.currency:
        raise HTTPException(status_code=422, detail="Reallocation is only allowed between lines of the same organization and currency")
    if available(source) < amount:
        raise HTTPException(status_code=422, detail=f"Only {available(source)} is uncommitted on {source.code}")
    if source.estimated_amount is not None and source.allocated_amount - amount < source.estimated_amount:
        raise HTTPException(422, "The reduced hard cap would be below the estimate; update the source estimate first")
    source.allocated_amount -= amount
    target.allocated_amount += amount
    _ledger(db, source, "REALLOCATE_OUT", amount, actor_id, reason)
    _ledger(db, target, "REALLOCATE_IN", amount, actor_id, reason)
    return source, target
