"""Technical Officers manage their regional schedules without changing other regions."""
from datetime import date, timedelta

import pytest


def body_for(period, region_id, **changes):
    return {"start_date": period["start_date"], "end_date": period["end_date"],
            "period_label": "Regional schedule", "status": "OPEN", "region_id": region_id, **changes}


@pytest.fixture
def regions(api):
    own = api.get("/admin/pay-period-regions", "tofficer1")[0]["id"]
    other = next(row["id"] for row in api.get("/admin/regions", "admin") if row["id"] != own)
    return own, other


def test_technical_creates_edits_and_closes_only_own_region(api, db, period, regions):
    from backend.models import AuditEvent, PayPeriod
    own, other = regions
    created = api.post("/admin/pay-periods", "tofficer1", body_for(period, own))
    assert created["region_id"] == own and created["can_manage"]
    closed = api.put(f"/admin/pay-periods/{created['id']}", "tofficer1",
                     body_for(period, own, status="CLOSED", period_label="Closed regional period"))
    assert closed["status"] == "CLOSED"
    assert db.get(PayPeriod, period["id"]).status == "OPEN"
    api.post("/worklogs", "chw1", {"period_id": created["id"]}, expect=409)
    api.post("/worklogs", "chw1", {"period_id": period["id"]}, expect=409)
    reopened = api.put(f"/admin/pay-periods/{created['id']}", "tofficer1", body_for(period, own))
    assert reopened["status"] == "OPEN"
    assert db.query(AuditEvent).filter_by(entity_type="pay-periods", entity_id=str(created["id"])).count() == 3


def test_technical_cannot_write_global_or_foreign_periods(api, period, regions):
    own, other = regions
    api.post("/admin/pay-periods", "tofficer1", body_for(period, None), expect=403)
    api.post("/admin/pay-periods", "tofficer1", body_for(period, other), expect=403)
    api.put(f"/admin/pay-periods/{period['id']}", "tofficer1", body_for(period, None, status="CLOSED"), expect=403)
    foreign = api.post("/admin/pay-periods", "admin", body_for(period, other))
    api.put(f"/admin/pay-periods/{foreign['id']}", "tofficer1", body_for(period, own), expect=403)
    for actor in ("tofficer1", "chw1"):
        assert foreign["id"] not in {p["id"] for p in api.get("/admin/pay-periods", actor)}
    api.post("/worklogs", "chw1", {"period_id": foreign["id"]}, expect=422)
    api.post("/admin/pay-periods", "chw1", body_for(period, own), expect=403)
    api.post("/admin/pay-periods", "rpm1", body_for(period, own), expect=403)


def test_regional_dates_may_match_global_but_not_overlap_own_region(api, period, regions):
    own, other = regions
    created = api.post("/admin/pay-periods", "tofficer1", body_for(period, own))
    api.post("/admin/pay-periods", "admin", body_for(period, other))
    api.post("/admin/pay-periods", "tofficer1", body_for(period, own), expect=409)
    api.post("/admin/pay-periods", "tofficer1", body_for(
        period, own, start_date=str(date.fromisoformat(period["start_date"]) + timedelta(days=1)),
    ), expect=409)
    assert created["id"] in {p["id"] for p in api.get("/admin/pay-periods", "chw1")}


def test_submitted_period_dates_and_region_are_immutable_but_status_is_editable(api, db, period, regions):
    from backend.models import WorkLog
    own, other = regions
    created = api.post("/admin/pay-periods", "tofficer1", body_for(period, own))
    log = api.post("/worklogs", "chw1", {"period_id": created["id"]})
    db.get(WorkLog, log["id"]).status = "PENDING_TECHNICAL_REVIEW"
    db.commit()
    api.put(f"/admin/pay-periods/{created['id']}", "tofficer1", body_for(
        period, own, end_date=str(date.fromisoformat(period["end_date"]) - timedelta(days=1)),
    ), expect=409)
    api.put(f"/admin/pay-periods/{created['id']}", "admin", body_for(period, other), expect=409)
    api.put(f"/admin/pay-periods/{created['id']}", "tofficer1", body_for(period, own, status="CLOSED"))


@pytest.mark.parametrize("user", ["chw1", "hcp1", "clerk1"])
def test_sms_off_ctc_goes_directly_to_technical_for_all_cadres(api, db, period, monkeypatch, user):
    from backend.core import workflow_policy
    from backend.core.settings import DEFAULTS
    from backend.models import SMSOutbox
    assert DEFAULTS["provider_otp_required"] is False
    monkeypatch.setattr(workflow_policy, "NEW_RECORD_WORKFLOW_VERSION", 2)
    api.put("/admin/settings/provider_otp_required", "admin", {"value": False, "reason": "Provider SMS step removed"})
    before = db.query(SMSOutbox).filter_by(event_name="WORKLOG_OTP").count()
    try:
        log = api.post("/worklogs", user, {"period_id": period["id"], "work_type": "PAYROLL"})
        activity = log["cadre"]["activities"][0]
        types = {f["key"]: f["field_type"] for f in log["cadre"]["fields"]}
        payload = {"activity_key": activity["key"], "hours_worked": 1, "start_time": "08:00", "end_time": "09:00",
                   "measures": {key: False if types[key] == "BOOLEAN" else 0 for key in activity["required_fields"]}}
        api.put(f"/worklogs/{log['id']}/entries/{period['start_date']}", user, payload)
        api.post(f"/worklogs/{log['id']}/actions/submit", user, {"attest": True})
        verified = api.post(f"/worklogs/{log['id']}/actions/verify", "supervisor1", {
            "review_confirmed": True, "review_type": "PAYROLL", "expected_version": log["version"],
        })
        assert verified["status"] == "PENDING_TECHNICAL_REVIEW"
        assert verified["awaiting_my_otp"] is False
        assert verified["otp"] is None
        assert db.query(SMSOutbox).filter_by(event_name="WORKLOG_OTP").count() == before
        assert log["id"] in {r["id"] for r in api.get("/worklogs?queue=true", "tofficer1")}
    finally:
        api.put("/admin/settings/provider_otp_required", "admin", {"value": True, "reason": "Restore isolated OTP regression fixture"})


def test_migration_moves_waiting_logs_without_faking_provider_confirmation(api, db, period, monkeypatch):
    import importlib
    import sqlalchemy as sa
    from backend.models import SMSOutbox, WorkLog, WorkLogAudit
    from .conftest import draft_log
    log = draft_log(api, "chw1", period)
    api.post(f"/worklogs/{log['id']}/actions/submit", "chw1", {"attest": True})
    verified = api.post(f"/worklogs/{log['id']}/actions/verify", "supervisor1", {"expected_version": log["version"]})
    assert verified["status"] == "PENDING_PROVIDER_OTP_CONFIRMATION"
    migration = importlib.import_module("backend.alembic.versions.c713f80be249_regional_periods_without_provider_sms")
    pending = SMSOutbox(event_name="WORKLOG_OTP", destination_phone="+255710000101",
                        message_body="[redacted]", status="PENDING")
    db.add(pending); db.commit()
    try:
        monkeypatch.setattr(migration.op, "execute", lambda statement: db.execute(
            sa.text(statement) if isinstance(statement, str) else statement))
        migration._remove_provider_confirmation()
        migration._remove_provider_confirmation()
        db.commit()
        db.expire_all()
        assert db.get(WorkLog, log["id"]).status == "PENDING_TECHNICAL_REVIEW"
        rows = db.query(WorkLogAudit).filter_by(work_log_id=log["id"], action="provider_sms_removed").all()
        assert len(rows) == 1 and rows[0].actor_id is None
        assert rows[0].details["provider_confirmation"] == "not required"
        assert not db.query(WorkLogAudit).filter_by(work_log_id=log["id"], action="confirm_otp").count()
        assert db.get(SMSOutbox, pending.id).status == "SUPPRESSED"
    finally:
        api.put("/admin/settings/provider_otp_required", "admin", {"value": True, "reason": "Restore isolated OTP regression fixture"})
