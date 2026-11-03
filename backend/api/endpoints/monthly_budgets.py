"""Region-scoped monthly Services budgets with authenticated supporting documents."""
from decimal import Decimal
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session
from ...db.session import get_db
from ...core.security import require_roles
from ...core.roles import REGIONAL_FINANCE, FHI360_FINANCE
from ...core import audit
from ...models import MonthlyServiceBudget, Region
from ...services import monthly_service_budgets as budgets
from ...services.v22_scope import regions_for

router = APIRouter()
READ = require_roles(REGIONAL_FINANCE, FHI360_FINANCE)


@router.get("")
def list_budgets(month: Optional[str] = Query(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
                 db: Session = Depends(get_db), current=Depends(READ)):
    query = budgets.visible(db, current)
    if month:
        budgets.validate_month(month)
        query = query.filter(MonthlyServiceBudget.month == month)
    return [budgets.summary(row) for row in query.order_by(MonthlyServiceBudget.month.desc(), MonthlyServiceBudget.region_id)]


@router.post("")
async def upload_budget(region_id: int = Form(gt=0), month: str = Form(...),
                        allocated_amount: Decimal = Form(ge=0, max_digits=15, decimal_places=2),
                        currency: str = Form(default="TZS", pattern=r"^[A-Z]{3}$"),
                        file: UploadFile = File(...),
                        db: Session = Depends(get_db), current=Depends(require_roles(REGIONAL_FINANCE))):
    budgets.validate_month(month)
    if not current.unrestricted and region_id not in regions_for(current):
        raise HTTPException(403, "You may upload budgets only for your assigned regions.")
    suffix = Path(file.filename or "").suffix.lower()
    types = {".pdf": "application/pdf", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
             ".csv": "text/csv"}
    if suffix not in types:
        raise HTTPException(422, "Upload a PDF, XLSX or CSV budget document.")
    data = await file.read(2 * 1024 * 1024 + 1)
    if len(data) > 2 * 1024 * 1024:
        raise HTTPException(413, "Budget documents must be no larger than 2 MB.")
    if not data or (suffix == ".pdf" and not data.startswith(b"%PDF")) or (suffix == ".xlsx" and not data.startswith(b"PK")):
        raise HTTPException(422, "The budget document is empty or does not match its file type.")
    if suffix == ".csv":
        try:
            data.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise HTTPException(422, "CSV budget documents must use UTF-8 encoding.")
    # Serialize initial creation and updates; routes lock the budget itself.
    region = db.query(Region).filter_by(id=region_id).with_for_update().first()
    if not region:
        raise HTTPException(404, "Region not found.")
    row = (db.query(MonthlyServiceBudget).filter_by(region_id=region_id, month=month, currency=currency)
           .with_for_update().populate_existing().first())
    before = budgets.summary(row) if row else None
    if row and allocated_amount < row.deducted_amount:
        raise HTTPException(409, "The revised budget cannot be lower than its already-deducted amount.")
    if not row:
        row = MonthlyServiceBudget(region_id=region_id, month=month, currency=currency, deducted_amount=0)
        db.add(row)
    row.allocated_amount = allocated_amount
    row.document_name = Path((file.filename or "budget").replace("\\", "/")).name[:255]
    row.document_type, row.document_data, row.uploaded_by = types[suffix], data, current.id
    db.flush()
    audit.record(db, current, "monthly_service_budget", row.id, "upload",
                 before=before, after=budgets.summary(row))
    db.commit()
    return budgets.summary(row)


@router.get("/{budget_id}/document")
def download_document(budget_id: int, db: Session = Depends(get_db), current=Depends(READ)):
    row = budgets.visible(db, current).filter(MonthlyServiceBudget.id == budget_id).first()
    if not row:
        raise HTTPException(404, "Budget document not found.")
    suffix = Path(row.document_name).suffix.lower()
    return Response(row.document_data, media_type=row.document_type,
                    headers={"Content-Disposition": f'attachment; filename="regional-budget-{row.month}{suffix}"',
                             "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
