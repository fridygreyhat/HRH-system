"""Scheduled SMS: reviewer summaries and reminders, and the monthly reminder to providers who have not submitted.

With 1,000+ timesheets a region, reviewers get one summary SMS of what is new (at most every few hours) and one daily
reminder of what has waited over 24 hours, not one SMS per timesheet. Providers who have not submitted the month's
timesheet get a reminder on the set days (23rd and 25th). Everything runs from the background worker every hour.
"""
from datetime import datetime, timedelta

from sqlalchemy import func

from ..core.period_dates import PAY_MONTH_END_DAY, pay_month_of, pay_month_range
from ..core.roles import CSO_TECHNICAL, PROVIDER, REGIONAL_FINANCE, RPM, TECHNICAL_OFFICER
from ..core.settings import get_setting
from ..core.timeutil import TZ
from ..models import PayPeriod, Role, SMSOutbox, Staff, StaffAssignment, User, UserRole, WorkLog, utcnow
from . import notifications
from .payment_forms import month_text
from .scope import users_in_scope_for
from . import worklog_workflow as wf

EDITABLE = {wf.DRAFT, wf.RETURNED, wf.REJECTED}


def _local_now():
    return datetime.now(TZ)


def _sending_hours(db, now):
    return get_setting(db, "sms_send_from_hour") <= now.hour < get_setting(db, "sms_send_until_hour")


def waiting_by_reviewer(db):
    """{user id: [time each waiting timesheet reached them]}: every timesheet whose next step is this person's."""
    logs = db.query(WorkLog).filter(
        (WorkLog.status.in_(list(wf.STAGE_OWNER)))
        # Regional Finance approves RM-approved Payroll before signing the region's month.
        | ((WorkLog.work_type == "PAYROLL") & (WorkLog.status == wf.APPROVED) & (WorkLog.workflow_version >= 2)
           & WorkLog.finance_timesheet_approved_at.is_(None))).all()
    reviewers, people = {}, {}
    for log in logs:
        owner = REGIONAL_FINANCE if log.status == wf.APPROVED else wf.stage_owner(db, log)
        assignment = db.get(StaffAssignment, log.assignment_id)
        strict = log.workflow_version >= 2 and owner in {CSO_TECHNICAL, TECHNICAL_OFFICER, RPM, REGIONAL_FINANCE}
        key = (owner, assignment.region_id, assignment.facility_id, assignment.community_area_id, log.cadre_id, strict)
        if key not in people:  # providers at the same facility share their reviewers
            people[key] = users_in_scope_for(db, owner, assignment, cadre_id=log.cadre_id, strict_cadre=strict)
        provider_user = db.get(Staff, log.staff_id).user_id
        for user in people[key]:
            if user.id != provider_user:
                reviewers.setdefault(user.id, (user, []))[1].append(log.status_changed_at)
    return reviewers


def _last_sent(db, event):
    return dict(db.query(SMSOutbox.user_id, func.max(SMSOutbox.created_at)).filter(SMSOutbox.event_name == event)
                .group_by(SMSOutbox.user_id))


def run_reviewer_sms(db, now=None):
    """One summary of new timesheets per reviewer (at most every review_digest_hours), and one daily reminder of those
    waiting longer than reminder_after_hours. Only within the sending hours."""
    now_local = now or _local_now()
    if get_setting(db, "reviewer_sms_each_timesheet") or not _sending_hours(db, now_local):
        return 0
    now = now_local.astimezone(utcnow().tzinfo)
    digest_every = timedelta(hours=get_setting(db, "review_digest_hours"))
    after = get_setting(db, "reminder_after_hours")
    repeat = timedelta(hours=get_setting(db, "reminder_repeat_hours"))
    last_digest, last_overdue = _last_sent(db, "REVIEW_DIGEST"), _last_sent(db, "REVIEW_OVERDUE")
    sent = 0
    for user_id, (user, arrivals) in waiting_by_reviewer(db).items():
        previous = last_digest.get(user_id)
        if previous is None or previous <= now - digest_every:
            new = [t for t in arrivals if previous is None or t > previous]
            if new:
                notifications.enqueue(db, "REVIEW_DIGEST", user, None, count=len(new), total=len(arrivals))
                sent += 1
        overdue = [t for t in arrivals if t <= now - timedelta(hours=after)]
        reminded = last_overdue.get(user_id)
        if overdue and (reminded is None or reminded <= now - repeat):
            notifications.enqueue(db, "REVIEW_OVERDUE", user, None, count=len(overdue), hours=after)
            sent += 1
    db.commit()
    return sent


def run_submit_reminders(db, now=None):
    """On the set days, from the set hour: providers whose timesheet for the pay month is not submitted. Once a day."""
    now_local = now or _local_now()
    if now_local.day not in set(get_setting(db, "submit_reminder_days")) or now_local.hour < get_setting(db, "submit_reminder_hour"):
        return 0
    today = now_local.date()
    month = pay_month_of(today)
    start, end = pay_month_range(month)
    day_start = datetime(today.year, today.month, today.day, tzinfo=TZ)
    already = {uid for (uid,) in db.query(SMSOutbox.user_id).filter(SMSOutbox.event_name == "TIMESHEET_DUE", SMSOutbox.created_at >= day_start)}
    periods = db.query(PayPeriod.id).filter(PayPeriod.start_date <= end, PayPeriod.end_date >= start)
    submitted = {sid for (sid,) in db.query(WorkLog.staff_id).filter(
        WorkLog.period_id.in_(periods), WorkLog.status.notin_(EDITABLE | {wf.CANCELLED}))}
    providers = (db.query(User, Staff).join(Staff, Staff.user_id == User.id)
                 .join(UserRole, UserRole.user_id == User.id).join(Role, Role.id == UserRole.role_id)
                 .filter(Role.name == PROVIDER, User.is_active.is_(True), Staff.status == "ACTIVE",
                         Staff.id.in_(db.query(StaffAssignment.staff_id).filter(
                             StaffAssignment.start_date <= end,
                             (StaffAssignment.end_date.is_(None)) | (StaffAssignment.end_date >= start)))))
    deadline = f"{PAY_MONTH_END_DAY} {month_text(month)}"
    sent = 0
    for user, staff in providers:
        if user.id in already or staff.id in submitted:
            continue
        notifications.enqueue(db, "TIMESHEET_DUE", user, staff.verified_phone, period=month_text(month), deadline=deadline)
        sent += 1
    db.commit()
    return sent
