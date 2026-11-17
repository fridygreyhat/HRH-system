"""Central Finance sets the full monthly salary for each salary scale."""
from decimal import Decimal

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...core import audit
from ...core.roles import FHI360_FINANCE
from ...core.security import require_roles
from ...db.session import get_db
from ...models import SalaryScaleAmount
from ...services import monthly_report_approval as reports, salary_amounts as amounts

router = APIRouter()
MONTH = r"^\d{4}-(0[1-9]|1[0-2])$"


class SalaryAmountIn(BaseModel):
    scale: str = Field(min_length=1, max_length=50, pattern=r"\S")
    start_month: str = Field(pattern=MONTH)
    # For the CHW package, leave out: it is the sum of the parts.
    monthly_amount: Optional[Decimal] = Field(default=None, gt=0, max_digits=15, decimal_places=2)
    # The CHW package only: the stipend, transport and communication amounts.
    components: Optional[dict[str, Decimal]] = None


def _amount_and_parts(body: SalaryAmountIn, scale: str):
    if scale.upper() != amounts.CHW_SCALE:
        if body.components:
            raise HTTPException(422, "Only the CHW package is made of parts. Enter one monthly amount for this scale.")
        if body.monthly_amount is None:
            raise HTTPException(422, "Enter the monthly amount.")
        return body.monthly_amount, None
    keys = [key for key, _ in amounts.CHW_PARTS]
    given = body.components or {}
    if set(given) != set(keys):
        raise HTTPException(422, "The CHW package needs the monthly stipend, transport and communication amounts.")
    for key in keys:
        value = given[key]
        if value < 0 or value != value.quantize(Decimal("0.01")) or value >= Decimal("1e13"):
            raise HTTPException(422, "Each CHW package amount must be zero or more, in shillings and cents.")
    total = sum(given.values())
    if total <= 0:
        raise HTTPException(422, "The CHW package must pay more than zero in total.")
    if body.monthly_amount is not None and body.monthly_amount != total:
        raise HTTPException(422, f"The CHW package total is the sum of its parts: {total}.")
    return total, amounts.chw_components(given)


@router.get("")
def list_amounts(month: str = Query(pattern=MONTH), db: Session = Depends(get_db), _=Depends(require_roles(FHI360_FINANCE))):
    reports.check_month(month)
    return amounts.overview(db, month)


@router.put("")
def save_amount(body: SalaryAmountIn, db: Session = Depends(get_db), current=Depends(require_roles(FHI360_FINANCE))):
    reports.check_month(body.start_month)
    scale = body.scale.strip()
    if scale.upper() == amounts.CHW_SCALE:
        scale = amounts.CHW_SCALE
    monthly_amount, parts = _amount_and_parts(body, scale)
    from ...services.salary_amounts import amounts_for
    signed = reports.signed_with_scale(db, scale, body.start_month)
    before_amounts = {s.id: amounts_for(db, s.month).get(scale) for s in signed}  # what each signed month pays now
    row = db.query(SalaryScaleAmount).filter_by(scale=scale, start_month=body.start_month).with_for_update().first()
    before = {"monthly_amount": str(row.monthly_amount), "components": row.components} if row else None
    if row is None:
        row = SalaryScaleAmount(scale=scale, start_month=body.start_month)
        db.add(row)
    row.monthly_amount, row.components, row.updated_by = monthly_amount, parts, current.id
    db.flush()
    audit.record(db, current, "salary_scale_amount", row.id, "set_salary_amount", before=before,
                 after={"scale": scale, "start_month": body.start_month, "monthly_amount": str(monthly_amount), "components": parts})
    taken_back = reports.withdraw_for_salary_change(db, current, scale, body.start_month, before_amounts)
    db.commit()
    return {"scale": scale, "start_month": row.start_month, "monthly_amount": str(row.monthly_amount), "components": row.components,
            "signed_months_taken_back": [{"month": t["month"], "region_id": t["region_id"]} for t in taken_back]}
