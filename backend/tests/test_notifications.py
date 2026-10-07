"""Acceptance criteria 17–18: SMS after commit via outbox, 48h reminders, stale suppression, failures isolated."""
from sqlalchemy import text

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

    process_outbox(db)
    db.expire_all()
    # The submission message became stale (status moved on) and is suppressed; the approval is sent.
    assert _outbox(db, log["id"], "WORKLOG_SUBMITTED")[0][1] == "SUPPRESSED"
    assert _outbox(db, log["id"], "WORKLOG_APPROVED")[0][1] == "SENT"
    body = db.execute(text("select message_body from sms_outbox where id = :i"), {"i": approved[0][0]}).scalar()
    assert "not a payment confirmation" in body or "si uthibitisho wa malipo" in body
    assert "TZS" not in body


def test_reminders_after_48_hours_without_duplicates(api, period, db):
    from backend.worker import run_reminders

    log = draft_log(api, "hcp1", period)
    api.post(f"/worklogs/{log['id']}/actions/submit", "hcp1", {"attest": True})
    assert run_reminders(db) == 0 or not _outbox(db, log["id"], "WORKLOG_REMINDER")
    db.execute(text("update work_logs set status_changed_at = now() - interval '49 hours' where id = :i"), {"i": log["id"]})
    db.commit()
    run_reminders(db)
    assert len(_outbox(db, log["id"], "WORKLOG_REMINDER")) == 1
    run_reminders(db)
    assert len(_outbox(db, log["id"], "WORKLOG_REMINDER")) == 1  # no duplicate within 48h
    db.execute(text("update sms_outbox set created_at = created_at - interval '49 hours' where related_id = :i and event_name = 'WORKLOG_REMINDER'"), {"i": log["id"]})
    db.execute(text("update work_logs set status_changed_at = now() - interval '100 hours' where id = :i"), {"i": log["id"]})
    db.commit()
    run_reminders(db)
    assert len(_outbox(db, log["id"], "WORKLOG_REMINDER")) == 2  # repeats no more often than every 48h

    api.post(f"/worklogs/{log['id']}/actions/verify", "supervisor1")  # stage resolved
    from backend.worker import process_outbox

    process_outbox(db)
    db.expire_all()
    statuses = {s for _, s, _ in _outbox(db, log["id"], "WORKLOG_REMINDER")}
    assert statuses == {"SUPPRESSED"}  # stale reminders are not delivered


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
