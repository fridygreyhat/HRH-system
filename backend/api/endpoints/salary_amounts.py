"""Central Finance sets the full monthly salary for each salary scale."""
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
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
    monthly_amount: Decimal = Field(gt=0, max_digits=15, decimal_places=2)


@router.get("")
def list_amounts(month: str = Query(pattern=MONTH), db: Session = Depends(get_db), _=Depends(require_roles(FHI360_FINANCE))):
    reports.check_month(month)
    return amounts.overview(db, month)


@router.put("")
def save_amount(body: SalaryAmountIn, db: Session = Depends(get_db), current=Depends(require_roles(FHI360_FINANCE))):
    reports.check_month(body.start_month)
    scale = body.scale.strip()
    row = db.query(SalaryScaleAmount).filter_by(scale=scale, start_month=body.start_month).with_for_update().first()
    before = {"monthly_amount": str(row.monthly_amount)} if row else None
    if row is None:
        row = SalaryScaleAmount(scale=scale, start_month=body.start_month)
        db.add(row)
    row.monthly_amount, row.updated_by = body.monthly_amount, current.id
    db.flush()
    audit.record(db, current, "salary_scale_amount", row.id, "set_salary_amount", before=before,
                 after={"scale": scale, "start_month": body.start_month, "monthly_amount": str(body.monthly_amount)})
    db.commit()
    return {"scale": scale, "start_month": row.start_month, "monthly_amount": str(row.monthly_amount)}
