"""Pay-period setup with explicit regional authority; legacy global rows stay global."""
from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, func
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from ...core import audit
from ...core.period_dates import period_date_error
from ...core.roles import CENTRAL_ADMIN, FHI360_FINANCE, TECHNICAL_OFFICER, SUPER_ADMIN
from ...core.security import CurrentUser, get_current_user, require_roles
from ...core.serialize import to_dict
from ...db.session import get_db
from ...models import (
    BudgetLine,
    Cadre,
    OTPChallenge,
    PaymentClaim,
    PayPeriod,
    Region,
    Staff,
    StaffAssignment,
    User,
    WorkLog,
    WorkLogEntry,
    WorkLogMeasure,
    utcnow,
)
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
    date_lock_reason = period_date_lock_reason(db, period.id)
    archive_reason = archive_block_reason(db, period.id) if SUPER_ADMIN in current.roles else None
    archived = period.status == "ARCHIVED"
    return {**to_dict(period), "region_name": db.get(Region, period.region_id).name if period.region_id else None,
            "can_manage": not archived and can_manage(current, period.region_id),
            "can_edit_dates": not archived and can_manage(current, period.region_id) and date_lock_reason is None,
            "date_lock_reason": date_lock_reason,
            "can_archive": SUPER_ADMIN in current.roles and not archived and archive_reason is None,
            "archive_block_reason": archive_reason,
            "can_delete": SUPER_ADMIN in current.roles and not period_in_use(db, period.id)}


def archive_block_reason(db, period_id):
    if db.query(PaymentClaim.id).filter(PaymentClaim.period_id == period_id, PaymentClaim.status != "CANCELLED").first():
        return "Payment claims use this period. Cancel unpaid claims through Finance first; periods with completed payments cannot be restarted."
    if db.query(WorkLog.id).filter_by(period_id=period_id, status="PAID").first():
        return "Paid work protects this period from being restarted."
    if db.query(BudgetLine.id).filter(BudgetLine.period_id == period_id,
            or_(BudgetLine.committed_amount > 0, BudgetLine.spent_amount > 0)).first():
        return "Committed or spent budget funds protect this period. Finance must resolve unpaid commitments first."
    return None


class ArchiveIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    reason: str = Field(min_length=3, max_length=1000)
    confirmation: str


class ProviderPeriodResetIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    reason: str = Field(min_length=3, max_length=1000)
    confirmation: str = Field(min_length=1, max_length=200)


def provider_period_records(db, period):
    rows = (
        db.query(WorkLog, Staff, Cadre, User.username)
        .join(Staff, Staff.id == WorkLog.staff_id)
        .join(Cadre, Cadre.id == WorkLog.cadre_id)
        .outerjoin(User, User.id == Staff.user_id)
        .filter(WorkLog.period_id == period.id)
        .order_by(Staff.first_name, Staff.middle_name, Staff.last_name, WorkLog.work_type, WorkLog.id)
        .all()
    )
    log_ids = [log.id for log, _, _, _ in rows]
    entries_by_log = {}
    for entry in db.query(WorkLogEntry).filter(WorkLogEntry.work_log_id.in_(log_ids)).all() if log_ids else []:
        count, hours = entries_by_log.get(entry.work_log_id, (0, 0.0))
        entries_by_log[entry.work_log_id] = (count + 1, hours + float(entry.hours_worked or 0))
    claimed_log_ids = {
        log_id for (log_id,) in db.query(PaymentClaim.work_log_id).filter(
            PaymentClaim.work_log_id.in_(log_ids),
        ).all() if log_id is not None
    } if log_ids else set()

    providers = {}
    for log, staff, cadre, username in rows:
        entry_count, hours = entries_by_log.get(log.id, (0, 0.0))
        reason = None
        if period.status == "ARCHIVED":
            reason = "This pay period is archived."
        elif log.status == "PAID":
            reason = "Paid work is protected from reset."
        elif log.id in claimed_log_ids:
            reason = "A payment claim is linked to this work record."
        log_data = {
            "id": log.id,
            "work_type": log.work_type,
            "status": log.status,
            "entry_count": entry_count,
            "total_hours": round(hours, 2),
            "can_reset": reason is None,
            "reset_block_reason": reason,
        }
        provider = providers.setdefault(staff.id, {
            "staff_id": staff.id,
            "staff_name": staff.legal_name,
            "username": username or f"staff-{staff.id}",
            "cadre_code": cadre.code,
            "work_logs": [],
        })
        provider["work_logs"].append(log_data)

    for provider in providers.values():
        blocked = [log["reset_block_reason"] for log in provider["work_logs"] if log["reset_block_reason"]]
        has_work_to_reset = any(
            log["entry_count"] or log["status"] != "DRAFT"
            for log in provider["work_logs"]
        )
        provider["can_reset"] = not blocked and has_work_to_reset
        provider["reset_block_reason"] = (
            blocked[0] if blocked else
            None if has_work_to_reset else
            "There are no submitted entries or workflow state to reset."
        )
    return providers


@router.get("/pay-periods/{period_id}/provider-records")
def list_provider_period_records(period_id: int, db: Session = Depends(get_db),
                                 current: CurrentUser = Depends(require_roles(SUPER_ADMIN))):
    period = db.get(PayPeriod, period_id)
    if not period:
        raise HTTPException(404, "Pay period not found")
    providers = provider_period_records(db, period)
    return {
        "period": {
            "id": period.id,
            "period_label": period.period_label,
            "start_date": period.start_date,
            "end_date": period.end_date,
            "status": period.status,
            "region_name": db.get(Region, period.region_id).name if period.region_id else None,
        },
        "providers": list(providers.values()),
    }


@router.post("/pay-periods/{period_id}/providers/{staff_id}/reset-records")
def reset_provider_period_records(period_id: int, staff_id: int, body: ProviderPeriodResetIn,
                                  db: Session = Depends(get_db),
                                  current: CurrentUser = Depends(require_roles(SUPER_ADMIN))):
    try:
        period = db.query(PayPeriod).filter_by(id=period_id).with_for_update(nowait=True).first()
        if not period:
            raise HTTPException(404, "Pay period not found")
        if period.status == "ARCHIVED":
            raise HTTPException(409, "Archived work is read-only and cannot be reset.")

        staff = db.get(Staff, staff_id)
        if not staff:
            raise HTTPException(404, "Provider not found")
        user = db.get(User, staff.user_id) if staff.user_id else None
        username = user.username if user else f"staff-{staff.id}"
        expected_confirmation = f"RESET {username} {period_id}"
        if body.confirmation != expected_confirmation:
            raise HTTPException(422, f"Type {expected_confirmation} to confirm")

        logs = (
            db.query(WorkLog)
            .filter_by(period_id=period_id, staff_id=staff_id)
            .order_by(WorkLog.id)
            .with_for_update(nowait=True)
            .all()
        )
        if not logs:
            raise HTTPException(404, "This provider has no work records in the selected period")
        log_ids = [log.id for log in logs]
        if any(log.status == "PAID" for log in logs):
            raise HTTPException(409, "Paid work is protected and cannot be reset.")
        if db.query(PaymentClaim.id).filter(PaymentClaim.work_log_id.in_(log_ids)).first():
            raise HTTPException(409, "A payment claim is linked to this provider's work. Preserve the financial record; it cannot be reset.")

        entries = db.query(WorkLogEntry).filter(WorkLogEntry.work_log_id.in_(log_ids)).all()
        if not entries and all(log.status == "DRAFT" for log in logs):
            raise HTTPException(409, "There are no submitted entries or workflow state to reset.")
        entry_ids = [entry.id for entry in entries]
        entries_cleared = len(entries)
        old_state = [
            {"work_log_id": log.id, "work_type": log.work_type, "status": log.status}
            for log in logs
        ]
        if entry_ids:
            db.query(WorkLogMeasure).filter(WorkLogMeasure.entry_id.in_(entry_ids)).delete(synchronize_session=False)
        db.query(OTPChallenge).filter(OTPChallenge.work_log_id.in_(log_ids)).delete(synchronize_session=False)
        db.query(WorkLogEntry).filter(WorkLogEntry.id.in_(entry_ids)).delete(synchronize_session=False) if entry_ids else None

        for log in logs:
            previous_status = log.status
            log.status = "DRAFT"
            log.confirmed_version = None
            log.attested_at = None
            log.submitted_at = None
            log.approved_at = None
            log.submit_gps_lat = None
            log.submit_gps_lon = None
            log.submit_gps_accuracy_m = None
            log.period_comment = None
            log.finance_snapshot = None
            log.routed_channel = None
            log.status_changed_at = utcnow()
            from ...services import worklog_workflow as wf
            wf.audit(
                db, current, log, "admin_reset", SUPER_ADMIN, previous_status,
                comment=body.reason,
                details={"entries_cleared": entries_cleared, "period_id": period_id},
            )

        audit.record(
            db, current, "provider-period-records", f"{staff_id}:{period_id}", "reset",
            before={"work_logs": old_state, "entries_cleared": entries_cleared},
            after={"work_logs_reset": len(logs), "entries_cleared": entries_cleared},
            reason=body.reason,
        )
        db.commit()
    except OperationalError:
        db.rollback()
        raise HTTPException(409, "These records are being changed. Reload and try again.")
    except Exception:
        db.rollback()
        raise
    return {
        "reset": True,
        "staff_id": staff_id,
        "period_id": period_id,
        "work_logs_reset": len(logs),
        "entries_cleared": entries_cleared,
    }


@router.post("/pay-periods/{period_id}/archive")
def archive_period(period_id: int, body: ArchiveIn, db: Session = Depends(get_db),
                   current: CurrentUser = Depends(require_roles(SUPER_ADMIN))):
    if body.confirmation != f"ARCHIVE {period_id}":
        raise HTTPException(422, f"Type ARCHIVE {period_id} to confirm")
    try:
        period = db.query(PayPeriod).filter_by(id=period_id).with_for_update(nowait=True).populate_existing().first()
        if not period:
            raise HTTPException(404, "Pay period not found")
        if period.status == "ARCHIVED":
            raise HTTPException(409, "This period is already archived")
        # Fail rather than race a save, approval, claim or budget transaction.
        db.query(WorkLog).filter_by(period_id=period_id).with_for_update(nowait=True).all()
        db.query(PaymentClaim).filter_by(period_id=period_id).with_for_update(nowait=True).all()
        db.query(BudgetLine).filter_by(period_id=period_id).with_for_update(nowait=True).all()
        reason = archive_block_reason(db, period_id)
        if reason:
            raise HTTPException(409, reason)
        counts = dict(db.query(WorkLog.status, func.count(WorkLog.id)).filter_by(
            period_id=period_id).group_by(WorkLog.status).all())
        before = to_dict(period)
        period.status = "ARCHIVED"
        audit.record(db, current, "pay-periods", period.id, "archive", before=before,
                     after={**to_dict(period), "preserved_work_by_status": counts}, reason=body.reason)
        db.commit()
    except OperationalError:
        db.rollback()
        raise HTTPException(409, "This period is being changed. Wait for that operation to finish, then review it again.")
    return {"archived": True, "id": period_id, "preserved_work_by_status": counts}

def period_date_lock_reason(db, period_id):
    if db.query(PaymentClaim.id).filter_by(period_id=period_id).first():
        return "Payment claims already use this period. Its dates are protected; its label and status can still be edited."
    if db.query(BudgetLine.id).filter_by(period_id=period_id).first():
        return "Budget lines already use this period. Its dates are protected; its label and status can still be edited."
    if db.query(WorkLog.id).filter(WorkLog.period_id == period_id, WorkLog.status != "DRAFT").first():
        return "Submitted work records already use this period. Its dates are protected; its label and status can still be edited."
    return None


def period_in_use(db, period_id):
    return any(db.query(model.id).filter(model.period_id == period_id).first()
               for model in (WorkLog, PaymentClaim, BudgetLine))


@router.delete("/pay-periods/{period_id}")
def delete_period(period_id: int, db: Session = Depends(get_db),
                  current: CurrentUser = Depends(require_roles(SUPER_ADMIN))):
    period = db.query(PayPeriod).filter_by(id=period_id).with_for_update().first()
    if not period:
        raise HTTPException(404, "Pay period not found")
    if period_in_use(db, period_id):
        raise HTTPException(409, "This period has work logs, claims or budget lines. Close it instead; its records cannot be deleted.")
    audit.record(db, current, "pay-periods", period.id, "delete", before=to_dict(period))
    db.delete(period)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "This period is now in use and cannot be deleted.")
    return {"deleted": True, "id": period_id}


@router.get("/pay-period-regions")
def period_regions(db: Session = Depends(get_db),
                   current: CurrentUser = Depends(require_roles(CENTRAL_ADMIN, FHI360_FINANCE, TECHNICAL_OFFICER))):
    query = db.query(Region)
    if not global_manager(current):
        query = query.filter(Region.id.in_(regions_for(current)))
    return [{"id": row.id, "name": row.name} for row in query.order_by(Region.name)]


@router.get("/pay-periods")
def list_periods(include_archived: bool = False, db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)):
    if include_archived and SUPER_ADMIN not in current.roles:
        raise HTTPException(403, "Only Super Admin may list archived periods")
    query = db.query(PayPeriod)
    if not include_archived:
        query = query.filter(PayPeriod.status != "ARCHIVED")
    if not global_manager(current):
        query = query.filter(or_(PayPeriod.region_id.is_(None), PayPeriod.region_id.in_(visible_regions(db, current))))
    return [period_out(db, current, row) for row in query.order_by(PayPeriod.start_date.desc(), PayPeriod.id)]


def validate(db, current, body, existing=None):
    if existing and existing.status == "ARCHIVED":
        raise HTTPException(409, "Archived periods are read-only. Create a replacement period instead.")
    if existing and not can_manage(current, existing.region_id):
        raise HTTPException(403, "You may only manage pay periods in your assigned regions")
    if not can_manage(current, body.region_id):
        raise HTTPException(403, "Choose a region assigned to you; global periods require Central Admin or FHI360 Finance")
    date_error = period_date_error(body.start_date, body.end_date)
    if date_error:
        raise HTTPException(422, date_error)
    if body.region_id is not None and not db.get(Region, body.region_id):
        raise HTTPException(422, "Unknown region")
    if existing and existing.region_id != body.region_id:
        raise HTTPException(409, "A pay period cannot be moved to another region")
    if existing and (existing.start_date, existing.end_date) != (body.start_date, body.end_date):
        # Serialize with draft entry saves and submission, which lock their work-log row.
        db.query(WorkLog).filter_by(period_id=existing.id).with_for_update().all()
        reason = period_date_lock_reason(db, existing.id)
        if reason:
            raise HTTPException(409, reason)
        outside = db.query(WorkLogEntry).join(WorkLog, WorkLog.id == WorkLogEntry.work_log_id).filter(
            WorkLog.period_id == existing.id,
            or_(WorkLogEntry.entry_date < body.start_date, WorkLogEntry.entry_date > body.end_date),
        ).first()
        if outside:
            raise HTTPException(409, f"A saved workday ({outside.entry_date}) would fall outside these dates. Keep every saved workday inside the period.")
    # Lock regional setup against concurrent overlapping schedules.
    if body.region_id:
        db.query(Region).filter_by(id=body.region_id).with_for_update().one()
    overlaps = db.query(PayPeriod).filter(
        PayPeriod.status != "ARCHIVED",
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
