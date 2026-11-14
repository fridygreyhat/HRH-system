"""Regional Finance approves timesheets in bulk: a region can have more than 1,000 a month of each kind.

Only clean timesheets are approved together: no review flags and, for Services, a rate for every day. A flagged one is
listed apart for one-by-one review. Approving never sends anything: Services then go to Central Finance with "Send month",
and Payroll goes to the CSO when the region's month is signed (which needs every Payroll timesheet approved first)."""
from fastapi import HTTPException

from ..core.period_dates import pay_month_range
from ..models import Cadre, Facility, Staff, StaffAssignment, WorkLog, WorkLogEntry
from . import finance_gate
from . import worklog_workflow as wf
from .forms import review_summary
from .v22_scope import record_condition, regions_for

# Where each kind of timesheet waits for Regional Finance.
WAITING = {"SERVICES": [wf.PENDING_FINANCE], "PAYROLL": [wf.APPROVED]}
MAX_PER_REQUEST = 200  # the screen sends a long list in parts, so each request stays short


def _logs(db, current, work_type, month, region_id, cadre_id=None, facility_id=None):
    if not current.unrestricted and region_id not in regions_for(current):
        raise HTTPException(403, "This region is outside your Regional Finance scope.")
    start, end = pay_month_range(month)
    query = (db.query(WorkLog, Staff, Cadre, StaffAssignment)
             .join(Staff, Staff.id == WorkLog.staff_id).join(Cadre, Cadre.id == WorkLog.cadre_id)
             .join(StaffAssignment, StaffAssignment.id == WorkLog.assignment_id)
             .filter(WorkLog.work_type == work_type, WorkLog.workflow_version >= 2, WorkLog.status.in_(WAITING[work_type]),
                     StaffAssignment.region_id == region_id, WorkLog.staff_id != current.staff_id,
                     record_condition(current, WorkLog.assignment_id, WorkLog.cadre_id),
                     WorkLog.id.in_(db.query(WorkLogEntry.work_log_id).filter(WorkLogEntry.entry_date.between(start, end)))))
    if work_type == "PAYROLL":
        query = query.filter(WorkLog.finance_timesheet_approved_at.is_(None))
    if cadre_id:
        query = query.filter(WorkLog.cadre_id == cadre_id)
    if facility_id:
        query = query.filter(StaffAssignment.facility_id == facility_id)
    return query.order_by(Staff.first_name, Staff.last_name, WorkLog.id)


def check(db, current, log):
    """Why a timesheet must be looked at one by one (empty: it may be approved in bulk), and its amount (Services)."""
    try:
        reasons = [a["message"] for a in review_summary(db, log, current).get("anomalies", [])]
        amount = None
        if log.work_type == "SERVICES":
            preview = finance_gate.preview(db, log)  # once per timesheet: it prices every day
            reasons += list(preview.get("exceptions") or [])
            amount = (log.finance_snapshot or {}).get("total") or preview.get("total")
            if preview.get("total") in (None, "", "0", "0.00"):
                reasons.append("No amount: a rate is missing for this work.")
    except (KeyError, TypeError, ValueError, AttributeError):
        # A timesheet the checks cannot read is never approved in bulk.
        return ["Could not be checked automatically: review it one by one."], None
    return reasons, amount


def flags(db, current, log):
    return check(db, current, log)[0]


def review_list(db, current, work_type, month, region_id, cadre_id=None, facility_id=None):
    db.info["builtins_cache"], db.info["daily_rate_cache"] = {}, {}  # forms and day rates, read once for the whole list
    try:
        return _review_list(db, current, work_type, month, region_id, cadre_id, facility_id)
    finally:
        db.info.pop("builtins_cache", None)
        db.info.pop("daily_rate_cache", None)


def _review_list(db, current, work_type, month, region_id, cadre_id, facility_id):
    rows = []
    for log, staff, cadre, assignment in _logs(db, current, work_type, month, region_id, cadre_id, facility_id):
        facility = db.get(Facility, assignment.facility_id) if assignment.facility_id else None
        reasons, amount = check(db, current, log)
        rows.append({"work_log_id": log.id, "provider_name": staff.legal_name, "cadre": cadre.name, "cadre_id": cadre.id,
                     "facility": facility.name if facility else "Community / no facility", "status": log.status,
                     "step": ("timesheet" if not log.finance_timesheet_approved_at else "amount") if work_type == "SERVICES" else "timesheet",
                     "amount": str(amount) if amount is not None else None, "flags": reasons, "clean": not reasons,
                     "version": log.version})
    return {"work_type": work_type, "month": month, "region_id": region_id, "rows": rows,
            "counts": {"total": len(rows), "clean": sum(r["clean"] for r in rows), "flagged": sum(not r["clean"] for r in rows)}}


def approve(db, current, work_type, month, region_id, work_log_ids, funding_source_id=None):
    """Approve the clean timesheets among those chosen. Each one stands alone: one that cannot be approved is reported
    and skipped, and the rest still go through."""
    if len(work_log_ids) > MAX_PER_REQUEST:
        raise HTTPException(422, f"Approve at most {MAX_PER_REQUEST} at a time.")
    if work_type == "SERVICES" and not funding_source_id:
        raise HTTPException(422, "Choose the funding source for these Services.")
    db.info["builtins_cache"], db.info["daily_rate_cache"] = {}, {}
    try:
        return _approve(db, current, work_type, month, region_id, work_log_ids, funding_source_id)
    finally:
        db.info.pop("builtins_cache", None)
        db.info.pop("daily_rate_cache", None)


def _approve(db, current, work_type, month, region_id, work_log_ids, funding_source_id):
    chosen = set(work_log_ids)
    waiting = {log.id: (log, staff) for log, staff, _, _ in _logs(db, current, work_type, month, region_id).filter(WorkLog.id.in_(chosen or {-1}))}
    approved, skipped = [], []
    for log_id in work_log_ids:
        if log_id not in waiting:
            skipped.append({"work_log_id": log_id, "reason": "No longer waiting for Regional Finance in this region and month."})
            continue
        log, staff = waiting[log_id]
        reasons = flags(db, current, log)
        if reasons:
            skipped.append({"work_log_id": log_id, "provider_name": staff.legal_name, "reason": "; ".join(reasons)})
            continue
        details = {"review_confirmed": True, "review_type": work_type, "funding_source_id": funding_source_id}
        savepoint = db.begin_nested()
        try:
            if not log.finance_timesheet_approved_at:
                wf.transition(db, current, log, wf.FINANCE_TIMESHEET_APPROVE, "Approved in bulk", details, log.version)
            if work_type == "SERVICES":
                wf.transition(db, current, log, "finance_review", "Approved in bulk", details, log.version)
            savepoint.commit()
            approved.append(log_id)
        except HTTPException as error:
            savepoint.rollback()
            skipped.append({"work_log_id": log_id, "provider_name": staff.legal_name, "reason": str(error.detail)})
    db.commit()
    return {"approved": approved, "skipped": skipped}


def payroll_waiting(db, current, month, region_id):
    """RM-approved Payroll timesheets of a region's month that Regional Finance has not approved yet."""
    return _logs(db, current, "PAYROLL", month, region_id).count()
