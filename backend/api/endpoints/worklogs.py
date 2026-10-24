import re
from datetime import date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional, Union

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...core import config
from ...core.roles import PROVIDER
from ...core.security import CurrentUser, get_current_user, require_roles
from ...core.serialize import to_dict
from ...core.settings import get_setting
from ...core.timeutil import TZ, local_today
from ...db.session import get_db
from ...models import (
    Cadre,
    Facility,
    PaymentClaim,
    PayPeriod,
    Section,
    Staff,
    StaffAssignment,
    User,
    WorkLog,
    WorkLogAudit,
    WorkLogEndorsement,
    WorkLogEntry,
    WorkLogMeasure,
    WorkLogVersion,
    utcnow,
)
from ...services import claims as claims_service
from ...services import notifications
from ...services import worklog_workflow as wf
from ...services.forms import assignment_out, cadre_fields, cadre_out, entries_with_measures, review_summary, totals
from ...services.activities import activity_fields, activity_for
from ...services.work_hours import day_hours_violation, hour_limits
from ...services.geo import LOCATION_EXCEPTIONS, location_status
from ...services.otp import dev_code, issue_otp, verify_otp
from ...services.scope import assignment_for_period, can_see_gps, worklog_visibility

router = APIRouter()

# Long digit runs look like patient/client IDs or phone numbers, which must not go into work-log evidence.
ID_PATTERN = re.compile(r"\d{8,}")


class WorkLogCreate(BaseModel):
    period_id: int


class HeaderIn(BaseModel):
    occupation: Optional[str] = None
    occupation_other: Optional[str] = Field(default=None, max_length=100)
    section: Optional[str] = None
    period_comment: Optional[str] = Field(default=None, max_length=2000)


class EntryIn(BaseModel):
    activity_key: str = Field(min_length=1, max_length=80)
    activity_location: Optional[str] = Field(default=None, max_length=255)
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    hours_worked: Optional[Decimal] = Field(default=None, gt=0, le=24)
    evidence_text: str = Field(min_length=3, max_length=2000)
    comment: Optional[str] = Field(default=None, max_length=1000)
    measures: dict[str, Union[bool, int, float]] = {}
    gps_lat: Optional[float] = Field(default=None, ge=-90, le=90)
    gps_lon: Optional[float] = Field(default=None, ge=-180, le=180)
    gps_accuracy_m: Optional[float] = Field(default=None, ge=0)


class ActionIn(BaseModel):
    comment: Optional[str] = Field(default=None, max_length=2000)
    expected_version: Optional[int] = None
    # Field-level correction flags for returns: [{"entry_date": "2026-08-03", "field": "clients_screened", "note": "..."}]
    flags: list[dict] = []
    # Submission only
    attest: bool = False
    gps_lat: Optional[float] = Field(default=None, ge=-90, le=90)
    gps_lon: Optional[float] = Field(default=None, ge=-180, le=180)
    gps_accuracy_m: Optional[float] = Field(default=None, ge=0)


class OTPIn(BaseModel):
    code: Optional[str] = Field(default=None, min_length=4, max_length=8)  # not needed while provider_otp_required is off


def _get_log(db: Session, current: CurrentUser, log_id: int, lock: bool = False) -> WorkLog:
    query = db.query(WorkLog).filter(WorkLog.id == log_id, worklog_visibility(current))
    log = (query.with_for_update(of=WorkLog) if lock else query).first()
    if not log:
        raise HTTPException(status_code=404, detail="Work log not found")
    return log


def _editable_log(db: Session, current: CurrentUser, log_id: int) -> WorkLog:
    log = _get_log(db, current, log_id, lock=True)
    if current.staff_id != log.staff_id:
        raise HTTPException(status_code=403, detail="Only the provider who owns this work log can edit it")
    if log.status not in wf.EDITABLE_STATUSES:
        raise HTTPException(status_code=409, detail=f"The work log is locked in status {log.status}. Corrections need a return or reopen.")
    return log


def _summary(db: Session, log: WorkLog) -> dict:
    staff = db.get(Staff, log.staff_id)
    t = totals(db, log)
    assignment = db.get(StaffAssignment, log.assignment_id)
    facility = db.get(Facility, assignment.facility_id) if assignment.facility_id else None
    return {
        **to_dict(log, exclude=("submit_gps_lat", "submit_gps_lon", "submit_gps_accuracy_m")),
        "staff_name": staff.legal_name,
        "cadre_code": db.get(Cadre, log.cadre_id).code,
        "facility_name": facility.name if facility else None,
        "period_label": wf.period_label(db.get(PayPeriod, log.period_id)),
        "entry_count": t["days"],
        "total_hours": t["hours"],
        "hours_in_status": round((utcnow() - log.status_changed_at).total_seconds() / 3600, 1),
    }


def _detail(db: Session, current: CurrentUser, log: WorkLog) -> dict:
    staff = db.get(Staff, log.staff_id)
    period = db.get(PayPeriod, log.period_id)
    show_gps = can_see_gps(db, current, log.staff_id, log.assignment_id)
    entries = []
    for e, measures in entries_with_measures(db, log.id):
        row = to_dict(e, exclude=() if show_gps else ("gps_lat", "gps_lon", "gps_accuracy_m"))
        row["measures"] = measures
        row["location_exception"] = e.location_status in LOCATION_EXCEPTIONS
        entries.append(row)
    audit_rows = (
        db.query(WorkLogAudit, User.full_name)
        .outerjoin(User, User.id == WorkLogAudit.actor_id)
        .filter(WorkLogAudit.work_log_id == log.id)
        .order_by(WorkLogAudit.timestamp, WorkLogAudit.id)
        .all()
    )
    endorsements = (
        db.query(WorkLogEndorsement, User.full_name)
        .join(User, User.id == WorkLogEndorsement.actor_id)
        .filter(WorkLogEndorsement.work_log_id == log.id)
        .all()
    )
    actions = wf.available_actions(db, current, log)
    owner = current.staff_id == log.staff_id
    result = {
        **_summary(db, log),
        "staff": {"id": staff.id, "name": staff.legal_name, "first_name": staff.first_name, "middle_name": staff.middle_name,
                  "last_name": staff.last_name, "salary_scale": staff.salary_scale},
        "cadre": cadre_out(db, db.get(Cadre, log.cadre_id)),
        "assignment": assignment_out(db, db.get(StaffAssignment, log.assignment_id)),
        "period": to_dict(period),
        "entries": entries,
        "totals": totals(db, log),
        "review_summary": review_summary(db, log, current),
        "location_exception_count": sum(1 for e in entries if e["location_exception"]),
        "gps_visible": show_gps,
        "audit": [{**to_dict(a), "actor_name": name} for a, name in audit_rows],
        "endorsements": [{**to_dict(e), "actor_name": name} for e, name in endorsements],
        "versions": [{"version": v.version, "created_at": v.created_at} for v in db.query(WorkLogVersion).filter(WorkLogVersion.work_log_id == log.id).order_by(WorkLogVersion.version)],
        "available_actions": actions,
        "can_edit": owner and log.status in wf.EDITABLE_STATUSES,
        "awaiting_my_otp": owner and log.status == wf.PENDING_OTP,
        "dev_otp": dev_code(log.id) if owner and log.status == wf.PENDING_OTP else None,
        "claims": [{"id": c.id, "status": c.status, "payment_status": c.payment_status} for c in db.query(PaymentClaim).filter(PaymentClaim.work_log_id == log.id)],
    }
    _record_review_open(db, current, log, actions)
    return result


def _record_review_open(db: Session, current: CurrentUser, log: WorkLog, actions: list[str]) -> None:
    """First time a reviewer opens a log they can act on at this stage/version (review-open timestamp)."""
    if not actions or current.staff_id == log.staff_id:
        return
    seen = db.query(WorkLogAudit).filter(
        WorkLogAudit.work_log_id == log.id, WorkLogAudit.actor_id == current.id, WorkLogAudit.action == "opened",
        WorkLogAudit.version == log.version, WorkLogAudit.new_status == log.status,
    ).count()
    if not seen:
        wf.audit(db, current, log, "opened", None, log.status)
        db.commit()


@router.get("/statuses")
def statuses():
    return {"statuses": wf.ALL_STATUSES}


@router.get("")
def list_worklogs(
    queue: bool = False,
    mine: bool = False,
    status: Optional[str] = None,
    period_id: Optional[int] = None,
    cadre: Optional[str] = None,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    """`queue=true`: logs waiting on one of my reviewer roles within that role's scope (never my own)."""
    query = db.query(WorkLog).filter(worklog_visibility(current))
    if mine:
        query = query.filter(WorkLog.staff_id == current.staff_id)
    if queue:
        condition = wf.queue_condition(current)
        if condition is None:
            return []
        query = query.filter(condition)
    if status:
        query = query.filter(WorkLog.status == status)
    if period_id:
        query = query.filter(WorkLog.period_id == period_id)
    if cadre:
        query = query.join(Cadre, Cadre.id == WorkLog.cadre_id).filter(Cadre.code == cadre)
    order = WorkLog.status_changed_at.asc() if queue else WorkLog.updated_at.desc()
    return [_summary(db, log) for log in query.order_by(order).limit(500).all()]


@router.post("", status_code=201)
def create_worklog(body: WorkLogCreate, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(PROVIDER))):
    staff = current.staff
    if not staff or staff.status != "ACTIVE":
        raise HTTPException(status_code=403, detail="Your account is not linked to an active staff record")
    period = db.get(PayPeriod, body.period_id)
    if not period:
        raise HTTPException(status_code=404, detail="Pay period not found")
    if period.status != "OPEN":
        raise HTTPException(status_code=409, detail="This pay period is closed")
    if period.start_date > local_today():
        raise HTTPException(status_code=422, detail="This pay period has not started yet")
    existing = db.query(WorkLog).filter(WorkLog.staff_id == staff.id, WorkLog.period_id == period.id).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"You already have work log #{existing.id} for this period")
    assignment = assignment_for_period(db, staff.id, period)
    if not assignment:
        raise HTTPException(status_code=422, detail="You have no assignment covering this period. Contact your administrator.")

    log = WorkLog(
        staff_id=staff.id,
        period_id=period.id,
        assignment_id=assignment.id,
        cadre_id=staff.cadre_id,
        occupation=staff.occupation,
        occupation_other=staff.occupation_other,
        section=assignment.section,
        status=wf.DRAFT,
    )
    db.add(log)
    db.flush()
    wf.audit(db, current, log, "create", PROVIDER, None)
    db.commit()
    return _detail(db, current, log)


@router.get("/{log_id}")
def get_worklog(log_id: int, db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)):
    return _detail(db, current, _get_log(db, current, log_id))


@router.get("/{log_id}/versions/{version}")
def get_version(log_id: int, version: int, db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)):
    log = _get_log(db, current, log_id)
    row = db.query(WorkLogVersion).filter(WorkLogVersion.work_log_id == log.id, WorkLogVersion.version == version).first()
    if not row:
        raise HTTPException(status_code=404, detail="Version not found")
    return {"version": row.version, "created_at": row.created_at, "snapshot": row.snapshot}


@router.put("/{log_id}")
def update_header(log_id: int, body: HeaderIn, db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)):
    log = _editable_log(db, current, log_id)
    cadre = db.get(Cadre, log.cadre_id)
    if body.occupation is not None:
        options = cadre.occupation_options or []
        if options and body.occupation not in options:
            raise HTTPException(status_code=422, detail=f"Occupation must be one of {options}")
        if body.occupation.lower().startswith("other") and not (body.occupation_other or "").strip():
            raise HTTPException(status_code=422, detail="Specify the occupation")
    if body.section is not None:
        if not cadre.uses_section:
            raise HTTPException(status_code=422, detail="This cadre's form has no section")
        if not db.get(Section, body.section):
            raise HTTPException(status_code=422, detail="Unknown section")
    before = {k: getattr(log, k) for k in body.model_fields_set}
    for key in body.model_fields_set:
        setattr(log, key, getattr(body, key))
    log.attested_at = None
    wf.audit(db, current, log, "edit_header", PROVIDER, log.status, details={"before": before, "after": body.model_dump(exclude_unset=True)})
    db.commit()
    return _detail(db, current, log)


@router.put("/{log_id}/entries/{entry_date}")
def upsert_entry(log_id: int, entry_date: date, body: EntryIn, db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)):
    log = _editable_log(db, current, log_id)
    period = db.get(PayPeriod, log.period_id)
    cadre = db.get(Cadre, log.cadre_id)
    if not (period.start_date <= entry_date <= period.end_date):
        raise HTTPException(status_code=422, detail=f"{entry_date} is outside the period {period.start_date} – {period.end_date}")
    if entry_date > local_today():
        raise HTTPException(status_code=422, detail=f"{entry_date} is in the future")
    entry = db.query(WorkLogEntry).filter(WorkLogEntry.work_log_id == log.id, WorkLogEntry.entry_date == entry_date).first()
    backdate_hours = int(get_setting(db, "backdate_grace_hours"))
    earliest_allowed = datetime.now(TZ) - timedelta(hours=backdate_hours)
    # Timed activities use their completion time. Date-only CHW entries use
    # local end-of-day. Corrections to a previously recorded day are not a new
    # backdated entry and remain possible after a review return.
    completion_time = body.end_time if cadre.hours_mode != "DIRECT" and body.end_time else time.max
    completed_at = datetime.combine(entry_date, completion_time, tzinfo=TZ)
    if not entry and completed_at < earliest_allowed:
        raise HTTPException(status_code=422, detail=f"Work-log entries may only be backdated {backdate_hours} hours.")
    # Serialize edits by the staff member so concurrent submissions cannot
    # each pass the daily/weekly cap using the same remaining hours.
    db.query(Staff).filter(Staff.id == log.staff_id).with_for_update().one()
    if ID_PATTERN.search(body.evidence_text) or (body.comment and ID_PATTERN.search(body.comment)):
        raise HTTPException(status_code=422, detail="Evidence looks like it contains an ID or phone number. Do not record patient or client identifiers.")

    if cadre.hours_mode == "DIRECT":
        if body.hours_worked is None:
            raise HTTPException(status_code=422, detail="Hours worked is required")
        hours, start, end = body.hours_worked, None, None
    else:
        if not (body.start_time and body.end_time):
            raise HTTPException(status_code=422, detail="Start and end time are required")
        start_dt, end_dt = datetime.combine(entry_date, body.start_time), datetime.combine(entry_date, body.end_time)
        if end_dt <= start_dt:
            raise HTTPException(status_code=422, detail="End time must be after start time (same day)")
        hours = Decimal((end_dt - start_dt).total_seconds() / 3600).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        start, end = body.start_time, body.end_time

    fields = {f.key: f for f in cadre_fields(db, cadre.id)}
    activity = activity_for(cadre.code, body.activity_key)
    if not activity:
        raise HTTPException(status_code=422, detail=f"Select a valid activity for the {cadre.code} form.")
    if body.activity_key == "secondary_facility" and not (body.activity_location or "").strip():
        raise HTTPException(status_code=422, detail="Enter the name of the secondary facility.")
    if body.activity_key != "secondary_facility" and body.activity_location:
        raise HTTPException(status_code=422, detail="A secondary-facility name is only valid for that activity.")
    allowed_fields = activity_fields(cadre.code, body.activity_key, set(fields))
    unknown = set(body.measures) - set(fields)
    if unknown:
        raise HTTPException(status_code=422, detail=f"Not on the {cadre.code} form: {sorted(unknown)}")
    unlinked = set(body.measures) - allowed_fields
    if unlinked:
        raise HTTPException(status_code=422, detail=f"Measures are not part of the selected activity: {sorted(unlinked)}")
    values: dict[str, Decimal] = {}
    for key, raw in body.measures.items():
        if fields[key].field_type == "BOOLEAN":
            if not isinstance(raw, bool):
                raise HTTPException(status_code=422, detail=f"{fields[key].label_en} must be Yes or No")
            values[key] = Decimal(int(raw))
        else:
            if isinstance(raw, bool) or float(raw) != int(raw) or raw < 0 or raw > 10000:
                raise HTTPException(status_code=422, detail=f"{fields[key].label_en} must be a whole number between 0 and 10000")
            values[key] = Decimal(int(raw))

    limits = hour_limits(db)
    week_start = entry_date - timedelta(days=entry_date.weekday())
    week_end = week_start + timedelta(days=6)
    existing_hours = (
        db.query(WorkLogEntry)
        .join(WorkLog, WorkLog.id == WorkLogEntry.work_log_id)
        .filter(WorkLog.staff_id == log.staff_id, WorkLogEntry.entry_date >= week_start, WorkLogEntry.entry_date <= week_end)
        .all()
    )
    daily_total = sum(
        (Decimal(row.hours_worked) for row in existing_hours if row.entry_date == entry_date and (not entry or row.id != entry.id)),
        hours,
    )
    violation = day_hours_violation(entry_date, daily_total, limits)
    if violation:
        raise HTTPException(status_code=422, detail=violation["message"])
    weekly_total = sum(
        (Decimal(row.hours_worked) for row in existing_hours if row.entry_date.weekday() < 5 and (not entry or row.id != entry.id)),
        hours if entry_date.weekday() < 5 else Decimal(0),
    )
    if entry_date.weekday() < 5 and weekly_total > limits["weekly_hours"]:
        raise HTTPException(status_code=422, detail=f"Weekday hours may not exceed {limits['weekly_hours']} from Monday through Friday; Saturday clinics are separate (this entry would total {weekly_total}).")

    capture = "ENTRY" in get_setting(db, "gps_capture_events")
    lat, lon = (body.gps_lat, body.gps_lon) if capture else (None, None)
    assignment = db.get(StaffAssignment, log.assignment_id)
    facility = db.get(Facility, assignment.facility_id) if assignment.facility_id else None

    before = None
    if entry:
        before = {**to_dict(entry, exclude=("gps_lat", "gps_lon")), "measures": {m.field_key: m.value for m in db.query(WorkLogMeasure).filter(WorkLogMeasure.entry_id == entry.id)}}
        db.query(WorkLogMeasure).filter(WorkLogMeasure.entry_id == entry.id).delete()
    else:
        entry = WorkLogEntry(work_log_id=log.id, entry_date=entry_date)
        db.add(entry)
    entry.activity_key = body.activity_key
    entry.activity_location = (body.activity_location or "").strip() or None
    entry.start_time, entry.end_time, entry.hours_worked = start, end, hours
    entry.evidence_text, entry.comment = body.evidence_text.strip(), (body.comment or "").strip() or None
    if capture:
        entry.gps_lat, entry.gps_lon, entry.gps_accuracy_m = lat, lon, body.gps_accuracy_m if lat is not None else None
        entry.gps_captured_at = utcnow() if lat is not None else None
        entry.location_status = location_status(cadre.uses_facility_geofence, facility, lat, lon)
    db.flush()
    for key, value in values.items():
        db.add(WorkLogMeasure(entry_id=entry.id, field_key=key, value=value))
    log.attested_at = None  # content changed: the provider must attest again on submission
    after = {"date": entry_date, "hours": hours, "measures": values, "evidence": entry.evidence_text}
    wf.audit(db, current, log, "edit_entry", PROVIDER, log.status, details={"before": before, "after": after})
    db.commit()
    return _detail(db, current, log)


@router.delete("/{log_id}/entries/{entry_date}")
def delete_entry(log_id: int, entry_date: date, db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)):
    log = _editable_log(db, current, log_id)
    entry = db.query(WorkLogEntry).filter(WorkLogEntry.work_log_id == log.id, WorkLogEntry.entry_date == entry_date).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    db.delete(entry)
    log.attested_at = None
    wf.audit(db, current, log, "delete_entry", PROVIDER, log.status, details={"date": entry_date})
    db.commit()
    return _detail(db, current, log)


def _send_otp(db: Session, log: WorkLog) -> dict:
    staff = db.get(Staff, log.staff_id)
    code = issue_otp(db, log)
    db.commit()  # the challenge exists before the code leaves the building
    outbox = notifications.send_protected_now(
        db,
        "WORKLOG_OTP",
        db.get(User, staff.user_id) if staff.user_id else None,
        staff.verified_phone,
        secret_keys=("code",),
        code=code,
        period=wf.period_label(db.get(PayPeriod, log.period_id)),
        minutes=get_setting(db, "otp_ttl_minutes"),
    )
    db.commit()
    result = {"sms_status": outbox.status}
    if config.EXPOSE_DEV_OTP:
        result["dev_otp"] = code
    return result


@router.post("/{log_id}/actions/{action}")
def perform_action(log_id: int, action: str, body: ActionIn = ActionIn(), db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)):
    if action in wf.INTERNAL_ACTIONS:
        raise HTTPException(status_code=400, detail="Use the OTP confirmation endpoint")
    log = _get_log(db, current, log_id, lock=True)
    if action == "facility_endorse":
        if body.expected_version is not None and body.expected_version != log.version:
            raise HTTPException(status_code=409, detail="This work log changed since you opened it")
        wf.record_facility_endorsement(db, current, log, body.comment)
        db.commit()
        return _detail(db, current, log)

    details = {"flags": body.flags} if body.flags else None
    if action == "submit":
        if not body.attest:
            raise HTTPException(status_code=422, detail="Confirm that the entries are true and complete before submitting")
        if current.staff_id == log.staff_id and log.status in wf.EDITABLE_STATUSES:
            if get_setting(db, "gps_required_on_submit") and (body.gps_lat is None or body.gps_lon is None):
                raise HTTPException(status_code=422, detail="Your location is needed to submit. Turn on location (GPS) for this site and try again.")
            log.attested_at = utcnow()
            if (get_setting(db, "gps_required_on_submit") or "SUBMIT" in get_setting(db, "gps_capture_events")) and body.gps_lat is not None:
                log.submit_gps_lat, log.submit_gps_lon, log.submit_gps_accuracy_m = body.gps_lat, body.gps_lon, body.gps_accuracy_m
    wf.transition(db, current, log, action, body.comment, details, body.expected_version)
    db.commit()
    otp = _send_otp(db, log) if log.status == wf.PENDING_OTP else None
    return {**_detail(db, current, log), "otp": otp}


@router.get("/{log_id}/estimate")
def estimate(log_id: int, db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)):
    """Estimated payout from active approved rates. Not an approved amount: the claim decides what is paid."""
    return claims_service.estimate_for_work_log(db, _get_log(db, current, log_id))


@router.post("/{log_id}/otp/resend")
def resend_otp(log_id: int, db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)):
    log = _get_log(db, current, log_id, lock=True)
    if log.status != wf.PENDING_OTP:
        raise HTTPException(status_code=409, detail="This work log is not awaiting confirmation")
    if current.staff_id != log.staff_id:
        raise HTTPException(status_code=403, detail="Only the provider can request a new code")
    wf.audit(db, current, log, "otp_resend", PROVIDER, log.status)
    return _send_otp(db, log)


@router.post("/{log_id}/otp/confirm")
def confirm_otp(log_id: int, body: OTPIn, db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)):
    log = _get_log(db, current, log_id, lock=True)
    reason = wf.check_action(db, current, log, "confirm_otp")
    if reason:
        raise HTTPException(status_code=403, detail=reason)
    if not get_setting(db, "provider_otp_required"):
        # Logs verified before the code was switched off: the provider confirms without one.
        wf.transition(db, current, log, "confirm_otp", f"Provider confirmed version {log.version} (SMS code not required)")
        db.commit()
        return _detail(db, current, log)
    if not body.code:
        raise HTTPException(status_code=422, detail="Enter the confirmation code from the SMS")
    try:
        verify_otp(db, log, body.code)
    except HTTPException:
        wf.audit(db, current, log, "otp_failed", PROVIDER, log.status)
        db.commit()
        raise
    wf.transition(db, current, log, "confirm_otp", f"Provider confirmed version {log.version} by SMS code")
    db.commit()
    return _detail(db, current, log)
