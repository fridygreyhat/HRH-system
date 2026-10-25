"""Pay-period setup with explicit regional authority; legacy global rows stay global."""
from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...core import audit
from ...core.roles import CENTRAL_ADMIN, FHI360_FINANCE, TECHNICAL_OFFICER
from ...core.security import CurrentUser, get_current_user, require_roles
from ...core.serialize import to_dict
from ...db.session import get_db
from ...models import BudgetLine, PaymentClaim, PayPeriod, Region, StaffAssignment, WorkLog
from ...services.scope import assignments_in_role_scope
from ...services.v22_scope import regions_for

router = APIRouter()


class PeriodIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start_date: date
    end_date: date
    period_label: Optional[str] = Field(default=None, max_length=100)
    status: Literal["OPEN", "CLOSED"] = "OPEN"
    region_id: Optional[int] = None


def global_manager(current):
    return current.unrestricted or bool({CENTRAL_ADMIN, FHI360_FINANCE}.intersection(current.roles))


def visible_regions(db, current):
    regions = set(regions_for(current))
    if current.staff_id > 0:
        regions.update(r[0] for r in db.query(StaffAssignment.region_id).filter_by(staff_id=current.staff_id))
    for role in current.roles:
        scope = assignments_in_role_scope(current, role)
        if scope is not None:
            regions.update(r[0] for r in db.query(StaffAssignment.region_id).filter(StaffAssignment.id.in_(scope)))
    return regions


def can_manage(current, region_id):
    return global_manager(current) or (
        TECHNICAL_OFFICER in current.roles and region_id is not None and region_id in regions_for(current)
    )


def period_out(db, current, period):
    return {**to_dict(period), "region_name": db.get(Region, period.region_id).name if period.region_id else None,
            "can_manage": can_manage(current, period.region_id)}


@router.get("/pay-period-regions")
def period_regions(db: Session = Depends(get_db),
                   current: CurrentUser = Depends(require_roles(CENTRAL_ADMIN, FHI360_FINANCE, TECHNICAL_OFFICER))):
    query = db.query(Region)
    if not global_manager(current):
        query = query.filter(Region.id.in_(regions_for(current)))
    return [{"id": row.id, "name": row.name} for row in query.order_by(Region.name)]


@router.get("/pay-periods")
def list_periods(db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)):
    query = db.query(PayPeriod)
    if not global_manager(current):
        query = query.filter(or_(PayPeriod.region_id.is_(None), PayPeriod.region_id.in_(visible_regions(db, current))))
    return [period_out(db, current, row) for row in query.order_by(PayPeriod.start_date.desc(), PayPeriod.id)]


def validate(db, current, body, existing=None):
    if existing and not can_manage(current, existing.region_id):
        raise HTTPException(403, "You may only manage pay periods in your assigned regions")
    if not can_manage(current, body.region_id):
        raise HTTPException(403, "Choose a region assigned to you; global periods require Central Admin or FHI360 Finance")
    if body.end_date < body.start_date:
        raise HTTPException(422, "The end date is before the start date")
    if body.region_id is not None and not db.get(Region, body.region_id):
        raise HTTPException(422, "Unknown region")
    if existing and existing.region_id != body.region_id:
        raise HTTPException(409, "A pay period cannot be moved to another region")
    if existing and (existing.start_date, existing.end_date) != (body.start_date, body.end_date):
        if any(db.query(model.id).filter(model.period_id == existing.id).first()
               for model in (WorkLog, PaymentClaim, BudgetLine)):
            raise HTTPException(409, "This period is already in use; only its label and open/closed status may change")
    # Lock regional setup against concurrent overlapping schedules.
    if body.region_id:
        db.query(Region).filter_by(id=body.region_id).with_for_update().one()
    overlaps = db.query(PayPeriod).filter(
        PayPeriod.region_id == body.region_id, PayPeriod.start_date <= body.end_date,
        PayPeriod.end_date >= body.start_date,
    )
    if existing:
        overlaps = overlaps.filter(PayPeriod.id != existing.id)
    # Preserve historic global overlap handling; regional schedules must be unambiguous.
    if body.region_id is not None and overlaps.first():
        raise HTTPException(409, "A pay period already covers these dates in this region")


def commit(db):
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A period already exists for these dates and region")


@router.post("/pay-periods", status_code=201)
def create_period(body: PeriodIn, db: Session = Depends(get_db),
                  current: CurrentUser = Depends(require_roles(CENTRAL_ADMIN, FHI360_FINANCE, TECHNICAL_OFFICER))):
    validate(db, current, body)
    period = PayPeriod(**body.model_dump())
    db.add(period)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A period already exists for these dates and region")
    audit.record(db, current, "pay-periods", period.id, "create", after=body.model_dump())
    commit(db)
    return period_out(db, current, period)


@router.put("/pay-periods/{period_id}")
def update_period(period_id: int, body: PeriodIn, db: Session = Depends(get_db),
                  current: CurrentUser = Depends(require_roles(CENTRAL_ADMIN, FHI360_FINANCE, TECHNICAL_OFFICER))):
    period = db.query(PayPeriod).filter_by(id=period_id).with_for_update().first()
    if not period:
        raise HTTPException(404, "Pay period not found")
    validate(db, current, body, period)
    before = to_dict(period)
    for key, value in body.model_dump().items():
        setattr(period, key, value)
    audit.record(db, current, "pay-periods", period.id, "update", before=before, after=body.model_dump())
    commit(db)
    return period_out(db, current, period)
