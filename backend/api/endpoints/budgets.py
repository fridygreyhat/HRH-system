"""Budget lines, ledger, reallocation and the FHI360 HQ tracker boundary.

There is NO live connection to the FHI360 HQ activity-budget tracker. Its API/file format has not been supplied,
so FHI360 lines move through a controlled CSV import/export and are marked IMPORTED / EXPORTED / RECONCILED / ERROR.
"""
import csv
import io
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import or_, true
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...core import audit as system_audit
from ...core.roles import CSO_FINANCE, FHI360_FINANCE, OVERSIGHT, RPM
from ...core.security import CurrentUser, require_roles
from ...core.serialize import to_dict
from ...db.session import get_db
from ...models import BudgetLine, BudgetSyncLog, BudgetTransaction, ClaimCategory, Organization, PayPeriod, Region, User, utcnow
from ...services import budgets as bg, cso_regions
from ...services.v22_scope import regions_for

router = APIRouter()
READ_ROLES = (FHI360_FINANCE, CSO_FINANCE, RPM, OVERSIGHT)
TRACKER_COLUMNS = ["code", "name", "category", "period_start", "region", "allocated_amount", "external_ref", "estimated_amount (optional)"]


def _visibility(current: CurrentUser):
    if current.has_any(FHI360_FINANCE, OVERSIGHT):
        return true()
    conditions = []
    if CSO_FINANCE in current.roles:
        # Retain read-only historical allocations, including former/all-region budgets.
        conditions.append(BudgetLine.organization_id.in_(current.scope_values("organization_id")))
    if RPM in current.roles:
        conditions.append(BudgetLine.region_id.in_(regions_for(current)))
    return or_(*conditions) if conditions else BudgetLine.id == -1


def _can_manage(current: CurrentUser, line_org: Organization) -> bool:
    if line_org.type == "FHI360":
        return FHI360_FINANCE in current.roles
    return line_org.type == "CSO" and (FHI360_FINANCE in current.roles or
        (CSO_FINANCE in current.roles and line_org.id in current.scope_values("organization_id")))


def _validate_dimensions(db, org, category_id, period_id, region_id):
    if not org.is_active:
        raise HTTPException(422, "The budget organization is inactive")
    if not db.get(ClaimCategory, category_id):
        raise HTTPException(422, "Unknown activity category")
    period = db.get(PayPeriod, period_id)
    if not period or (region_id is not None and not db.get(Region, region_id)):
        raise HTTPException(422, "Unknown pay period or region")
    if period.region_id is not None and period.region_id != region_id:
        raise HTTPException(422, "The budget region must match the regional pay period")
    if org.type == "CSO":
        if region_id is None:
            raise HTTPException(422, "CSO budgets require a specific assigned region; all-region budgets are historical only")
        cso_regions.require_assignment(db, org.id, region_id, lock=True)


def _fhi360_org(db: Session) -> Organization:
    org = db.query(Organization).filter(Organization.type == "FHI360").first()
    if not org:
        raise HTTPException(status_code=409, detail="No FHI360 organization is configured")
    return org


def _out(db: Session, line: BudgetLine) -> dict:
    period = db.get(PayPeriod, line.period_id)
    return {
        **to_dict(line),
        "organization_name": db.get(Organization, line.organization_id).name,
        "category_name": db.get(ClaimCategory, line.category_id).name,
        "period_label": period.period_label or str(period.start_date),
        "region_name": db.get(Region, line.region_id).name if line.region_id else "All regions",
        "available_amount": bg.available(line),
        **bg.planning_status(line),
    }


class LineIn(BaseModel):
    code: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=255)
    organization_id: int
    category_id: int
    period_id: int
    region_id: Optional[int] = None
    allocated_amount: Decimal = Field(ge=0, max_digits=15, decimal_places=2)
    estimated_amount: Optional[Decimal] = Field(default=None, ge=0, max_digits=15, decimal_places=2)
    currency: str = Field(default="TZS", pattern=r"^[A-Z]{3}$")

    @model_validator(mode="after")
    def estimate_within_cap(self):
        if self.estimated_amount is not None and self.estimated_amount > self.allocated_amount:
            raise ValueError("Estimated spend cannot exceed the hard cap")
        return self


class AllocationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    allocated_amount: Decimal = Field(ge=0, max_digits=15, decimal_places=2)
    estimated_amount: Optional[Decimal] = Field(ge=0, max_digits=15, decimal_places=2)
    reason: str = Field(min_length=3, max_length=1000)

    @field_validator("reason")
    @classmethod
    def meaningful_reason(cls, value):
        if len(value.strip()) < 3:
            raise ValueError("Give a reason with at least three non-space characters")
        return value.strip()

    @model_validator(mode="after")
    def estimate_within_cap(self):
        if self.estimated_amount is not None and self.estimated_amount > self.allocated_amount:
            raise ValueError("Estimated spend cannot exceed the hard cap")
        return self


class ReallocateIn(BaseModel):
    from_line_id: int
    to_line_id: int
    amount: Decimal = Field(gt=0)
    reason: str = Field(min_length=3, max_length=1000)


class ReconcileIn(BaseModel):
    external_ref: Optional[str] = Field(default=None, max_length=255)
    comment: str = Field(min_length=3, max_length=1000)


@router.get("/lines")
def list_lines(period_id: Optional[int] = None, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(*READ_ROLES))):
    query = db.query(BudgetLine).filter(_visibility(current))
    if period_id:
        query = query.filter(BudgetLine.period_id == period_id)
    return [_out(db, line) for line in query.order_by(BudgetLine.period_id.desc(), BudgetLine.code)]


@router.post("/lines", status_code=201)
def create_line(body: LineIn, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(FHI360_FINANCE, CSO_FINANCE))):
    org = db.query(Organization).filter_by(id=body.organization_id).with_for_update().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    if not _can_manage(current, org):
        raise HTTPException(status_code=403, detail="You cannot manage this organization's budget")
    _validate_dimensions(db, org, body.category_id, body.period_id, body.region_id)
    if org.type == "CSO" and db.query(BudgetLine.id).filter_by(
        organization_id=org.id, category_id=body.category_id, period_id=body.period_id, region_id=body.region_id,
    ).first():
        raise HTTPException(409, "This CSO already has a budget for the selected region, category and pay period")
    line = BudgetLine(
        **body.model_dump(),
        source="FHI360_TRACKER" if org.type == "FHI360" else "CSO",
        sync_status="UNSYNCED" if org.type == "FHI360" else "NOT_APPLICABLE",
    )
    db.add(line)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A budget line with this code already exists for the organization, period and region")
    db.add(BudgetTransaction(budget_line_id=line.id, kind="ALLOCATE", amount=body.allocated_amount, actor_id=current.id, reason="Initial allocation"))
    system_audit.record(db, current, "budget_line", line.id, "create", after=body.model_dump())
    db.commit()
    return _out(db, line)


@router.put("/lines/{line_id}/allocation")
def update_allocation(line_id: int, body: AllocationIn, db: Session = Depends(get_db),
                      current: CurrentUser = Depends(require_roles(FHI360_FINANCE, CSO_FINANCE))):
    line = db.query(BudgetLine).filter(BudgetLine.id == line_id, _visibility(current)).first()
    if not line:
        raise HTTPException(404, "Budget line not found")
    org = db.query(Organization).filter_by(id=line.organization_id).with_for_update().one()
    if not _can_manage(current, org):
        raise HTTPException(403, "You cannot manage this organization's budget")
    _validate_dimensions(db, org, line.category_id, line.period_id, line.region_id)
    line = bg.lock(db, line.id)
    if body.allocated_amount < line.committed_amount + line.spent_amount:
        raise HTTPException(422, "The hard cap cannot be below committed plus spent funds")
    before = to_dict(line)
    delta = body.allocated_amount - line.allocated_amount
    line.allocated_amount, line.estimated_amount = body.allocated_amount, body.estimated_amount
    if line.source == "FHI360_TRACKER":
        line.sync_status = "UNSYNCED"
    if delta:
        db.add(BudgetTransaction(budget_line_id=line.id, kind="ALLOCATE", amount=delta,
                                actor_id=current.id, reason=body.reason))
    system_audit.record(db, current, "budget_line", line.id, "update_allocation",
                        before=before, after=to_dict(line), reason=body.reason)
    db.commit()
    return _out(db, line)


@router.get("/lines/{line_id}/ledger")
def ledger(line_id: int, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(*READ_ROLES))):
    line = db.query(BudgetLine).filter(BudgetLine.id == line_id, _visibility(current)).first()
    if not line:
        raise HTTPException(status_code=404, detail="Budget line not found")
    rows = (
        db.query(BudgetTransaction, User.full_name)
        .outerjoin(User, User.id == BudgetTransaction.actor_id)
        .filter(BudgetTransaction.budget_line_id == line.id)
        .order_by(BudgetTransaction.id)
    )
    return {"line": _out(db, line), "transactions": [{**to_dict(t), "actor_name": name} for t, name in rows]}


@router.post("/reallocate")
def reallocate(body: ReallocateIn, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(FHI360_FINANCE, CSO_FINANCE, RPM))):
    source = db.get(BudgetLine, body.from_line_id)
    target = db.get(BudgetLine, body.to_line_id)
    if not source or not target:
        raise HTTPException(status_code=404, detail="Budget line not found")
    if source.organization_id != target.organization_id:
        raise HTTPException(422, "Reallocation is only allowed within the same organization")
    org = db.query(Organization).filter_by(id=source.organization_id).with_for_update().one()
    for line in (source, target):
        if not (_can_manage(current, org) or (RPM in current.roles and line.region_id in regions_for(current))):
            raise HTTPException(status_code=403, detail="You are not authorized to reallocate both regional budgets")
        _validate_dimensions(db, org, line.category_id, line.period_id, line.region_id)
    src, dst = bg.reallocate(db, body.from_line_id, body.to_line_id, body.amount, current.id, body.reason)
    for line in (src, dst):
        if line.source == "FHI360_TRACKER":
            line.sync_status = "UNSYNCED"
    system_audit.record(db, current, "budget_line", src.id, "reallocate", after={"to": dst.id, "amount": body.amount}, reason=body.reason)
    db.commit()
    return {"from": _out(db, src), "to": _out(db, dst)}


@router.post("/tracker/import")
async def tracker_import(file: UploadFile = File(...), db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(FHI360_FINANCE))):
    """Import FHI360 activity-budget allocations from a tracker CSV export (columns: code,name,category,period_start,region,allocated_amount,external_ref)."""
    org = _fhi360_org(db)
    content = (await file.read()).decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(content))
    missing = {"code", "name", "category", "period_start", "allocated_amount"} - set(reader.fieldnames or [])
    if missing:
        raise HTTPException(status_code=422, detail=f"Missing columns {sorted(missing)}; expected {TRACKER_COLUMNS}")
    log = BudgetSyncLog(sync_type="IMPORT", filename=file.filename, sync_status="SUCCESS", performed_by=current.id, log_data={"errors": []},
                        records_processed=0, success_count=0, error_count=0)
    errors = []
    for line_no, row in enumerate(reader, start=2):
        log.records_processed += 1
        try:
            with db.begin_nested():
                category = db.query(ClaimCategory).filter(ClaimCategory.name == row["category"].strip()).first()
                period = db.query(PayPeriod).filter(PayPeriod.start_date == date.fromisoformat(row["period_start"].strip())).first()
                region = db.query(Region).filter(Region.name == (row.get("region") or "").strip()).first() if (row.get("region") or "").strip() else None
                if not category or not period or ((row.get("region") or "").strip() and not region):
                    raise ValueError("Unknown category, period or region")
                amount = Decimal(row["allocated_amount"].strip())
                line = db.query(BudgetLine).filter(
                    BudgetLine.code == row["code"].strip(), BudgetLine.organization_id == org.id, BudgetLine.period_id == period.id,
                    BudgetLine.region_id == region.id if region else BudgetLine.region_id.is_(None),
                ).with_for_update().populate_existing().first()
                if line is None:
                    line = BudgetLine(code=row["code"].strip(), name=row["name"].strip(), source="FHI360_TRACKER", organization_id=org.id,
                                      category_id=category.id, period_id=period.id, region_id=region.id if region else None, allocated_amount=0)
                    db.add(line)
                    db.flush()
                estimate_text = (row.get("estimated_amount") or "").strip()
                estimate = (Decimal(estimate_text) if estimate_text else None) if "estimated_amount" in row else line.estimated_amount
                validated = AllocationIn(allocated_amount=amount, estimated_amount=estimate, reason="Tracker import")
                amount = validated.allocated_amount
                if amount < line.committed_amount + line.spent_amount:
                    raise ValueError(f"Allocation {amount} is below committed + spent ({line.committed_amount + line.spent_amount})")
                delta = amount - line.allocated_amount
                before = to_dict(line)
                line.allocated_amount = amount
                line.estimated_amount = validated.estimated_amount
                line.external_ref = (row.get("external_ref") or "").strip() or line.external_ref
                line.sync_status, line.last_synced_at = "IMPORTED", utcnow()
                if delta:
                    db.add(BudgetTransaction(budget_line_id=line.id, kind="IMPORT_ADJUST", amount=delta, actor_id=current.id, reason=f"Tracker import {file.filename}"))
                system_audit.record(db, current, "budget_line", line.id, "tracker_import", before=before,
                                    after=to_dict(line), reason=f"Tracker import {file.filename}")
                log.success_count += 1
        except (ValueError, KeyError, InvalidOperation) as e:
            errors.append({"line": line_no, "error": str(e)})
    log.error_count = len(errors)
    log.sync_status = "SUCCESS" if not errors else ("PARTIAL" if log.success_count else "FAILED")
    log.log_data = {"errors": errors}
    log.completed_at = utcnow()
    db.add(log)
    system_audit.record(db, current, "budget_sync", None, "import", after={"file": file.filename, "ok": log.success_count, "errors": len(errors)})
    db.commit()
    return to_dict(log)


@router.post("/tracker/export")
def tracker_export(period_id: Optional[int] = None, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(FHI360_FINANCE))):
    """Export FHI360 line commitments/expenditure for upload to the HQ tracker; lines are marked EXPORTED."""
    org = _fhi360_org(db)
    query = db.query(BudgetLine).filter(BudgetLine.organization_id == org.id)
    if period_id:
        query = query.filter(BudgetLine.period_id == period_id)
    lines = query.order_by(BudgetLine.code).with_for_update().all()
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["code", "name", "period_start", "region", "external_ref", "allocated_amount", "committed_amount", "spent_amount", "currency", "estimated_amount"])
    for line in lines:
        period = db.get(PayPeriod, line.period_id)
        writer.writerow([line.code, line.name, period.start_date, db.get(Region, line.region_id).name if line.region_id else "", line.external_ref or "",
                         line.allocated_amount, line.committed_amount, line.spent_amount, line.currency,
                         line.estimated_amount if line.estimated_amount is not None else ""])
        line.sync_status, line.last_synced_at = "EXPORTED", utcnow()
    db.add(BudgetSyncLog(sync_type="EXPORT", filename="tracker-export.csv", records_processed=len(lines), success_count=len(lines),
                         sync_status="SUCCESS", performed_by=current.id, completed_at=utcnow()))
    system_audit.record(db, current, "budget_sync", None, "export", after={"lines": len(lines)})
    db.commit()
    return Response(buffer.getvalue(), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="fhi360-tracker-export.csv"'})


@router.post("/lines/{line_id}/reconcile")
def reconcile_line(line_id: int, body: ReconcileIn, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(FHI360_FINANCE))):
    line = db.query(BudgetLine).filter(BudgetLine.id == line_id).with_for_update().first()
    if not line or line.source != "FHI360_TRACKER":
        raise HTTPException(status_code=404, detail="FHI360 tracker line not found")
    line.sync_status = "RECONCILED"
    line.external_ref = body.external_ref or line.external_ref
    line.last_synced_at = utcnow()
    db.add(BudgetSyncLog(sync_type="RECONCILE", records_processed=1, success_count=1, sync_status="SUCCESS", performed_by=current.id,
                         log_data={"line_id": line.id, "comment": body.comment}, completed_at=utcnow()))
    system_audit.record(db, current, "budget_line", line.id, "reconcile", reason=body.comment)
    db.commit()
    return _out(db, line)


@router.get("/sync-logs")
def sync_logs(db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(FHI360_FINANCE, OVERSIGHT))):
    return [to_dict(s) for s in db.query(BudgetSyncLog).order_by(BudgetSyncLog.id.desc()).limit(100)]
