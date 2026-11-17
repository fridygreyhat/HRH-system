"""Monthly financial audit and reconciliation of Payroll and Services, by region and cadre."""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...core import audit
from ...core.security import CurrentUser, require_roles
from ...db.session import get_db
from ...models import PayrollPayment
from ...services import payroll_payments, reconciliation as rec

router = APIRouter()
MONTH = r"^\d{4}-(0[1-9]|1[0-2])$"
Viewer = require_roles(*rec.VIEWERS)


@router.get("")
def reconciliation(month: str = Query(pattern=MONTH), region_id: Optional[int] = Query(default=None, gt=0),
                   cadre: Optional[Literal["CHW", "DATA_CLERK", "HCP"]] = None,
                   work_type: Optional[Literal["PAYROLL", "SERVICES"]] = None,
                   db: Session = Depends(get_db), current: CurrentUser = Depends(Viewer)):
    return rec.build(db, current, month, region_id, cadre, work_type)


@router.get("/dashboard")
def dashboard(month: str = Query(pattern=MONTH), months: int = Query(default=6, ge=1, le=12),
              region_id: Optional[int] = Query(default=None, gt=0),
              db: Session = Depends(get_db), current: CurrentUser = Depends(Viewer)):
    """Salary, Services and budget for the month by region, cadre and funding source, with the months before."""
    return rec.dashboard(db, current, month, months, region_id)


@router.get("/overview")
def overview(start: str = Query(pattern=MONTH), end: str = Query(pattern=MONTH), region_id: Optional[int] = Query(default=None, gt=0),
             db: Session = Depends(get_db), current: CurrentUser = Depends(Viewer)):
    """The central dashboard: every region and every month in the range (at most 24 months)."""
    return rec.overview(db, current, start, end, region_id)


@router.get("/export")
def export(month: str = Query(pattern=MONTH), region_id: Optional[int] = Query(default=None, gt=0),
           cadre: Optional[Literal["CHW", "DATA_CLERK", "HCP"]] = None,
           work_type: Optional[Literal["PAYROLL", "SERVICES"]] = None, format: Literal["xlsx", "csv"] = "xlsx",
           db: Session = Depends(get_db), current: CurrentUser = Depends(Viewer)):
    result = rec.build(db, current, month, region_id, cadre, work_type)
    payload = rec.xlsx_file(result) if format == "xlsx" else rec.csv_file(result)
    audit.record(db, current, "finance_reconciliation", None, "download",
                 after={"month": month, "region_id": region_id, "cadre": cadre, "work_type": work_type, "format": format,
                        "digest": result["digest"], "rows": len(result["providers"])})
    db.commit()
    media = ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if format == "xlsx" else "text/csv; charset=utf-8")
    return Response(payload, media_type=media, headers={
        "Content-Disposition": f'attachment; filename="reconciliation-{month}.{format}"',
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


class SignIn(BaseModel):
    month: str = Field(pattern=MONTH)
    region_id: Optional[int] = Field(default=None, gt=0)
    expected_digest: str = Field(min_length=64, max_length=64)
    note: Optional[str] = Field(default=None, max_length=2000)


@router.post("/sign", status_code=201)
def sign(body: SignIn, db: Session = Depends(get_db), current: CurrentUser = Depends(Viewer)):
    row = rec.sign(db, current, body.month, body.region_id, body.expected_digest, body.note)
    db.commit()
    return rec.signoff(db, body.month, body.region_id, row.digest)


@router.get("/payroll-payments/{payment_id}/proof")
def payroll_payment_proof(payment_id: int, db: Session = Depends(get_db), current: CurrentUser = Depends(Viewer)):
    """The bank schedule a CSO uploaded with a salary payment, for an auditor in that region."""
    payment = db.get(PayrollPayment, payment_id)
    scope = rec.region_scope(current)
    if payment is None or (scope is not None and payment.region_id not in scope):
        raise HTTPException(404, "Salary payment not found")
    path = payroll_payments.proof_path(payment)
    audit.record(db, current, "payroll_payment", payment.id, "download_proof")
    db.commit()
    return FileResponse(path, media_type=payment.proof_content_type, filename=payment.proof_filename,
                        headers={"X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox", "Cache-Control": "no-store"})


@router.get("/payroll-payments")
def payroll_payments_for(month: str = Query(pattern=MONTH), staff_id: int = Query(gt=0),
                         db: Session = Depends(get_db), current: CurrentUser = Depends(Viewer)):
    """Every salary payment recorded for one provider this month (voided ones too), to check an issue."""
    scope = rec.region_scope(current)
    rows = db.query(PayrollPayment).filter_by(month=month, staff_id=staff_id).order_by(PayrollPayment.id).all()
    return [payroll_payments.payment_out(db, row) for row in rows if scope is None or row.region_id in scope]
