"""Active phone numbers at registration, reviewer summary SMS and reminders, and the monthly provider reminder."""
from datetime import date, datetime, timedelta

import pytest

from backend.core.timeutil import TZ
from backend.models import PayPeriod, SMSOutbox, Staff, SystemSetting, User, WorkLog, utcnow
from backend.services import reminders
from .test_approval_finance_visibility import prepare
from .test_bank_only_cadres import _staff
from .test_ctc_facility_approval import no_provider_sms
from .test_v22_finance import v22

pytestmark = pytest.mark.usefixtures("no_provider_sms")


@pytest.fixture
def all_day_sms(db):
    """Reviewer SMS go out only in working hours; tests run at any time of day."""
    for key, value in (("sms_send_from_hour", 0), ("sms_send_until_hour", 24)):
        db.merge(SystemSetting(key=key, value=value))
    db.commit()
    yield
    for key in ("sms_send_from_hour", "sms_send_until_hour"):
        if db.get(SystemSetting, key):
            db.delete(db.get(SystemSetting, key))
    db.commit()


def test_registration_needs_an_active_tanzanian_mobile_and_sends_a_welcome_sms(api, db):
    created = api.post("/staff", "central1", _staff(api, "CHW", "0755 123 401", "MOBILE_WALLET"), expect=201)
    staff = db.get(Staff, created["id"])
    assert staff.verified_phone == "+255755123401"  # saved in the form the SMS gateway needs
    assert db.query(SMSOutbox).filter_by(event_name="WELCOME", destination_phone="+255755123401").count() == 1
    refused = api.post("/staff", "central1", _staff(api, "CHW", "+15551234567", "MOBILE_WALLET"), expect=422)
    assert "Tanzanian mobile" in str(refused)
    api.post("/staff", "central1", _staff(api, "CHW", "075 5123401", "MOBILE_WALLET"), expect=409)  # the same number again
    # The record shows whether the SMS reached the number: waiting, then sent (or failed for a wrong number).
    assert api.get(f"/staff/{staff.id}", "central1")["phone_check"]["status"] == "PENDING"
    from backend.worker import process_outbox
    while process_outbox(db):  # 50 at a time; earlier tests may have left messages queued ahead of this one
        pass
    assert api.get(f"/staff/{staff.id}", "central1")["phone_check"]["status"] == "SENT"


def test_reviewers_get_one_summary_then_a_daily_reminder_not_one_sms_per_timesheet(api, db, period, v22, all_day_sms):
    logs = [prepare(api, db, period, v22, who, "PAYROLL") for who in ("chw1", "hcp1")]
    supervisor = db.query(User).filter_by(username="supervisor1").one()
    assert all(log["status"] == "PENDING_CTC_VERIFICATION" for log in logs)
    # No SMS per timesheet at submission.
    assert not db.query(SMSOutbox).filter(SMSOutbox.event_name == "WORKLOG_SUBMITTED",
                                          SMSOutbox.related_id.in_([log["id"] for log in logs])).count()
    db.query(SMSOutbox).filter(SMSOutbox.user_id == supervisor.id, SMSOutbox.event_name.in_(["REVIEW_DIGEST", "REVIEW_OVERDUE"])).delete()
    db.commit()

    assert reminders.run_reviewer_sms(db) >= 1
    digest = db.query(SMSOutbox).filter_by(user_id=supervisor.id, event_name="REVIEW_DIGEST").one()
    assert "new timesheets to review" in digest.message_body or "majedwali mapya" in digest.message_body
    reminders.run_reviewer_sms(db)
    assert db.query(SMSOutbox).filter_by(user_id=supervisor.id, event_name="REVIEW_DIGEST").count() == 1  # not again within 3 hours

    # After 24 hours: one reminder of everything overdue, not repeated within the day.
    for log in logs:
        db.get(WorkLog, log["id"]).status_changed_at = utcnow() - timedelta(hours=25)
    db.commit()
    reminders.run_reviewer_sms(db)
    reminders.run_reviewer_sms(db)
    overdue = db.query(SMSOutbox).filter_by(user_id=supervisor.id, event_name="REVIEW_OVERDUE").all()
    assert len(overdue) == 1 and "24" in overdue[0].message_body


def test_nothing_is_sent_to_reviewers_outside_the_sending_hours(db):
    assert reminders.run_reviewer_sms(db, now=datetime.now(TZ).replace(hour=22)) == 0


def test_providers_who_have_not_submitted_are_reminded_on_the_23rd_and_25th(api, db):
    chw = db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == "chw1").one()
    hcp = db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == "hcp1").one()
    period = PayPeriod(start_date=date(2001, 2, 26), end_date=date(2001, 3, 25), status="OPEN", period_label="Reminder test")
    db.add(period)
    db.flush()
    from backend.models import StaffAssignment
    placement = db.query(StaffAssignment).filter_by(staff_id=chw.id).first()
    submitted = WorkLog(staff_id=chw.id, period_id=period.id, assignment_id=placement.id, cadre_id=chw.cadre_id,
                        status="PENDING_CTC_VERIFICATION", workflow_version=2, work_type="PAYROLL")
    db.add(submitted)
    db.commit()
    try:
        assert reminders.run_submit_reminders(db, now=datetime(2001, 3, 24, 9, tzinfo=TZ)) == 0  # not a reminder day
        assert reminders.run_submit_reminders(db, now=datetime(2001, 3, 23, 7, tzinfo=TZ)) == 0  # before 8:00
        assert reminders.run_submit_reminders(db, now=datetime(2001, 3, 23, 9, tzinfo=TZ)) >= 1
        due = db.query(SMSOutbox).filter(SMSOutbox.event_name == "TIMESHEET_DUE", SMSOutbox.created_at >= utcnow() - timedelta(minutes=5))
        hcp_user, chw_user = db.get(User, hcp.user_id), db.get(User, chw.user_id)
        assert due.filter(SMSOutbox.user_id == hcp_user.id).count() == 1  # has not submitted
        assert due.filter(SMSOutbox.user_id == chw_user.id).count() == 0  # already submitted
        assert "25 March 2001" in due.filter(SMSOutbox.user_id == hcp_user.id).one().message_body or "Machi" in due.filter(SMSOutbox.user_id == hcp_user.id).one().message_body
    finally:
        db.delete(submitted)
        db.commit()
        db.delete(period)
        db.commit()
