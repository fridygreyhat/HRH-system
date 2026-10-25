"""Acceptance criteria 17–18: SMS via outbox, 24h reminders, stale suppression, failures isolated."""
from sqlalchemy import text
import pytest

from .conftest import draft_log, submit_and_verify


def _outbox(db, log_id, event):
    return db.execute(text("select id, status, user_id from sms_outbox where related_id = :i and event_name = :e order by id"), {"i": log_id, "e": event}).all()


def test_stage_notifications_are_queued_and_delivered_by_the_worker(api, period, db):
    from backend.worker import process_outbox

    log = submit_and_verify(api, "clerk1", period)
    submitted = _outbox(db, log["id"], "WORKLOG_SUBMITTED")
    assert len(submitted) == 1  # to the facility's CTC In-Charge only
    api.post(f"/worklogs/{log['id']}/otp/confirm", "clerk1", {"code": log["otp"]["dev_otp"]})
    assert len(_outbox(db, log["id"], "WORKLOG_CONFIRMED")) == 1  # technical officer notified
    api.post(f"/worklogs/{log['id']}/actions/endorse", "tofficer1")
    assert len(_outbox(db, log["id"], "WORKLOG_ENDORSED")) == 1  # RPM notified
    api.post(f"/worklogs/{log['id']}/actions/authorize", "rpm1")
    approved = _outbox(db, log["id"], "WORKLOG_APPROVED")
    assert len(approved) == 1

    # Other acceptance scenarios share this test database and may already have
    # queued more messages than one normal (50-message) worker batch.
    pending_count = db.execute(text("select count(*) from sms_outbox where status = 'PENDING'")).scalar_one()
    process_outbox(db, limit=max(50, pending_count))
    db.expire_all()
    # The submission message became stale (status moved on) and is suppressed; the approval is sent.
    assert _outbox(db, log["id"], "WORKLOG_SUBMITTED")[0][1] == "SUPPRESSED"
    assert _outbox(db, log["id"], "WORKLOG_APPROVED")[0][1] == "SENT"
    body = db.execute(text("select message_body from sms_outbox where id = :i"), {"i": approved[0][0]}).scalar()
    assert "not a payment confirmation" in body or "si uthibitisho wa malipo" in body
    assert "TZS" not in body


def test_reminders_after_24_hours_without_duplicates(api, period, db, monkeypatch):
    from datetime import timedelta
    from backend import worker
    from backend.models import utcnow
    from backend.worker import run_reminders

    now = utcnow()
    monkeypatch.setattr(worker, "utcnow", lambda: now)
    log = draft_log(api, "hcp1", period)
    api.post(f"/worklogs/{log['id']}/actions/submit", "hcp1", {"attest": True})
    assert run_reminders(db) == 0 or not _outbox(db, log["id"], "WORKLOG_REMINDER")
    db.execute(text("update work_logs set status_changed_at = :pending where id = :i"),
               {"i": log["id"], "pending": now - timedelta(hours=24) + timedelta(seconds=1)})
    db.commit()
    run_reminders(db)
    assert not _outbox(db, log["id"], "WORKLOG_REMINDER")
    db.execute(text("update work_logs set status_changed_at = :pending where id = :i"),
               {"i": log["id"], "pending": now - timedelta(hours=24)})
    db.commit()
    run_reminders(db)
    assert len(_outbox(db, log["id"], "WORKLOG_REMINDER")) == 1
    run_reminders(db)
    assert len(_outbox(db, log["id"], "WORKLOG_REMINDER")) == 1
    db.execute(text("update work_logs set status_changed_at = :pending where id = :i"),
               {"i": log["id"], "pending": now - timedelta(hours=100)})
    db.execute(text("update sms_outbox set created_at = :sent where related_id = :i and event_name = 'WORKLOG_REMINDER'"),
               {"i": log["id"], "sent": now - timedelta(hours=24) + timedelta(seconds=1)})
    db.commit()
    run_reminders(db)
    assert len(_outbox(db, log["id"], "WORKLOG_REMINDER")) == 1
    db.execute(text("update sms_outbox set created_at = :sent where related_id = :i and event_name = 'WORKLOG_REMINDER'"),
               {"i": log["id"], "sent": now - timedelta(hours=24)})
    db.commit()
    run_reminders(db)
    assert len(_outbox(db, log["id"], "WORKLOG_REMINDER")) == 2

    api.post(f"/worklogs/{log['id']}/actions/verify", "supervisor1")  # stage resolved
    from backend.worker import process_outbox

    # New outbox rows use real creation timestamps; thaw the boundary-test clock
    # before processing rows whose next_attempt_at was created during this test.
    monkeypatch.setattr(worker, "utcnow", utcnow)
    process_outbox(db)
    db.expire_all()
    statuses = {s for _, s, _ in _outbox(db, log["id"], "WORKLOG_REMINDER")}
    assert statuses == {"SUPPRESSED"}  # stale reminders are not delivered


@pytest.mark.parametrize("threshold,age,overdue", [(24, 23.99, False), (24, 24, True), (36, 25, False), (36, 36, True)])
def test_reminder_queue_and_dashboard_use_same_deadline(api, period, db, monkeypatch, threshold, age, overdue):
    from datetime import timedelta
    from backend.api.endpoints import dashboard, worklogs
    from backend.core.settings import DEFAULTS
    from backend.models import utcnow

    monkeypatch.setitem(DEFAULTS, "reminder_after_hours", threshold)
    now = utcnow()
    monkeypatch.setattr(dashboard, "utcnow", lambda: now)
    monkeypatch.setattr(worklogs, "utcnow", lambda: now)
    log = draft_log(api, "chw1", period)
    log = api.post(f"/worklogs/{log['id']}/actions/submit", "chw1", {"attest": True})
    db.execute(text("update work_logs set status_changed_at = :pending where id = :i"),
               {"i": log["id"], "pending": now - timedelta(hours=age)})
    db.commit()
    detail = api.get(f"/worklogs/{log['id']}", "supervisor1")
    assert detail["reminder_after_hours"] == threshold
    assert detail["is_overdue"] is overdue
    report = api.get(f"/dashboard?period_id={period['id']}", "supervisor1")
    assert report["work_logs"]["reminder_after_hours"] == threshold
    queue = next(q for q in report["work_logs"]["queues"] if q["status"] == log["status"])
    assert queue["over_threshold"] == int(overdue)


def test_sms_failure_never_changes_workflow_state(api, period, db, monkeypatch):
    from backend import worker
    from backend.services import sms_gateway

    class Down(sms_gateway.SMSGateway):
        def send_sms(self, to, body, sensitive=False):
            return None

    monkeypatch.setattr(worker, "get_sms_gateway", lambda: Down())
    log = draft_log(api, "chw1", period)
    log = api.post(f"/worklogs/{log['id']}/actions/submit", "chw1", {"attest": True})
    for _ in range(6):
        worker.process_outbox(db)
        db.execute(text("update sms_outbox set next_attempt_at = now() where status = 'PENDING'"))
        db.commit()
    db.expire_all()
    row = _outbox(db, log["id"], "WORKLOG_SUBMITTED")[0]
    assert row[1] == "FAILED"
    assert api.get(f"/worklogs/{log['id']}", "chw1")["status"] == "PENDING_CTC_VERIFICATION"


def test_template_editing_is_versioned_validated_and_otp_protected(api, db):
    api.post("/admin/sms-templates", "rpm1", {"event_name": "WORKLOG_APPROVED", "language": "en", "template_text": "HRH: {period} approved {secret}"}, expect=422)
    api.post("/admin/sms-templates", "rpm1", {"event_name": "WORKLOG_OTP", "language": "en", "template_text": "Code {code}"}, expect=403)
    api.post("/admin/sms-templates", "chw1", {"event_name": "WORKLOG_APPROVED", "language": "en", "template_text": "HRH: {period} ok"}, expect=403)
    preview = api.post("/admin/sms-templates/preview", "rpm1", {"event_name": "WORKLOG_APPROVED", "language": "en", "template_text": "HRH: log for {period} approved."})
    assert preview["preview"] == "HRH: log for August 2026 approved."
    row = api.post("/admin/sms-templates", "rpm1", {"event_name": "WORKLOG_APPROVED", "language": "en", "template_text": "HRH: log for {period} approved. Not a payment."})
    assert row["version"] == 2
    templates = [t for t in api.get("/admin/sms-templates", "oversight1") if t["event_name"] == "WORKLOG_APPROVED" and t["language"] == "en"][0]
    assert templates["active_version"] == 2 and len(templates["versions"]) == 2
    assert [t for t in api.get("/admin/sms-templates", "oversight1") if t["event_name"] == "WORKLOG_OTP"][0]["active_text"] is None
