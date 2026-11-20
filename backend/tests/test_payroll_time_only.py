"""Payroll days record the time worked only: no activity to choose and no indicators to count, for every cadre."""
import pytest

from .test_v22_finance import v22  # noqa: F401  (fixture)

GPS = {"gps_lat": -9.33, "gps_lon": 34.77, "gps_accuracy_m": 12}


@pytest.fixture
def time_only(api):
    previous = api.get("/auth/me", "chw1")["client_settings"]["payroll_time_only"]
    api.put("/admin/settings/payroll_time_only", "admin", {"value": True, "reason": "Test time-only Payroll"})
    try:
        yield
    finally:
        api.put("/admin/settings/payroll_time_only", "admin", {"value": previous, "reason": "Restore test policy"})


def test_the_app_default_is_time_only():
    from backend.core.settings import DEFAULTS
    assert DEFAULTS["payroll_time_only"] is True


@pytest.mark.parametrize("provider", ["chw1", "hcp1", "clerk1"])
def test_every_cadre_records_a_payroll_day_with_times_only(api, period, monkeypatch, provider, time_only):
    from backend.core import workflow_policy
    monkeypatch.setattr(workflow_policy, "NEW_RECORD_WORKFLOW_VERSION", 2)
    assert api.get("/auth/me", provider)["client_settings"]["payroll_time_only"] is True
    log = api.post("/worklogs", provider, {"period_id": period["id"], "work_type": "PAYROLL"})
    # One choice, the time worked, with no indicator fields and start/end times rather than an hours box.
    assert [a["key"] for a in log["cadre"]["activities"]] == ["daily_attendance"]
    only = log["cadre"]["activities"][0]
    assert only["fields"] == [] and only["hours_input"] is False
    assert log["cadre"]["fields"] == []
    saved = api.put(f"/worklogs/{log['id']}/entries/{period['start_date']}", provider,
                    {"activity_key": "daily_attendance", "start_time": "08:00", "end_time": "15:30", "measures": {}, **GPS})
    entry = saved["entries"][0]
    assert float(entry["hours_worked"]) == 7.5 and entry["start_time"].startswith("08:00")
    # A task or an indicator is refused; so is a day without its times.
    other = "chw_daily_timesheet" if provider == "chw1" else "opd_screening"
    api.put(f"/worklogs/{log['id']}/entries/{period['start_date']}", provider,
            {"activity_key": other, "start_time": "08:00", "end_time": "15:30", "measures": {}, **GPS}, expect=422)
    api.put(f"/worklogs/{log['id']}/entries/{period['start_date']}", provider,
            {"activity_key": "daily_attendance", "hours_worked": 7, "measures": {}, **GPS}, expect=422)
    api.put(f"/worklogs/{log['id']}/entries/{period['start_date']}", provider,
            {"activity_key": "daily_attendance", "start_time": "08:00", "end_time": "15:30",
             "measures": {"opd_attendees": 3}, **GPS}, expect=422)
    submitted = api.post(f"/worklogs/{log['id']}/actions/submit", provider, {"attest": True})
    assert submitted["status"] == "PENDING_CTC_VERIFICATION"


def test_the_payroll_day_limit_still_applies(api, period, monkeypatch, time_only):
    from backend.core import workflow_policy
    monkeypatch.setattr(workflow_policy, "NEW_RECORD_WORKFLOW_VERSION", 2)
    log = api.post("/worklogs", "hcp1", {"period_id": period["id"], "work_type": "PAYROLL"})
    api.put(f"/worklogs/{log['id']}/entries/{period['start_date']}", "hcp1",
            {"activity_key": "daily_attendance", "start_time": "07:00", "end_time": "17:00", "measures": {}, **GPS}, expect=422)


def test_services_keep_their_activities(api, period, monkeypatch, time_only):
    from backend.core import workflow_policy
    monkeypatch.setattr(workflow_policy, "NEW_RECORD_WORKFLOW_VERSION", 2)
    log = api.post("/worklogs", "hcp1", {"period_id": period["id"], "work_type": "SERVICES"})
    assert "daily_attendance" not in [a["key"] for a in log["cadre"]["activities"]]


def test_a_day_recorded_with_an_activity_before_keeps_it_until_edited(api, db, period, monkeypatch, time_only):
    from backend.core import workflow_policy
    from backend.models import WorkLogEntry
    monkeypatch.setattr(workflow_policy, "NEW_RECORD_WORKFLOW_VERSION", 2)
    api.put("/admin/settings/payroll_time_only", "admin", {"value": False, "reason": "Record a day on the old form"})
    log = api.post("/worklogs", "hcp1", {"period_id": period["id"], "work_type": "PAYROLL"})
    activity = next(a for a in log["cadre"]["activities"] if a["key"] != "daily_attendance")
    fields = {f["key"]: f for f in activity["field_definitions"]}
    api.put(f"/worklogs/{log['id']}/entries/{period['start_date']}", "hcp1", {
        "activity_key": activity["key"], "start_time": "08:00", "end_time": "10:00", **GPS,
        "measures": {k: (True if fields[k].get("field_type") == "BOOLEAN" else 2) for k in activity["required_fields"]}})
    api.put("/admin/settings/payroll_time_only", "admin", {"value": True, "reason": "Back to time only"})
    shown = api.get(f"/worklogs/{log['id']}", "hcp1")
    keys = [a["key"] for a in shown["cadre"]["activities"]]
    assert keys[0] == "daily_attendance" and activity["key"] in keys  # the old day still reads as recorded
    assert shown["entries"][0]["measures"]
    edited = api.put(f"/worklogs/{log['id']}/entries/{period['start_date']}", "hcp1",
                     {"activity_key": "daily_attendance", "start_time": "08:00", "end_time": "12:00", "measures": {}, **GPS})
    assert edited["entries"][0]["activity_key"] == "daily_attendance" and not edited["entries"][0]["measures"]
    assert db.query(WorkLogEntry).filter_by(work_log_id=log["id"]).one().activity_snapshot["fields"] == []
