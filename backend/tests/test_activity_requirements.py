"""Acceptance checks for the imported CHW, Data Clerk and HCP activity sheets."""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from backend.core.timeutil import local_today
from .conftest import ENTRY
from backend.services.work_hours import day_hours_violation


@pytest.mark.parametrize("offset,hours,code", [
    (0, "9", None), (0, "9.01", "DAILY_HOURS"), (4, "9", None),
    (5, "3.99", "SATURDAY_HOURS"), (5, "4", None), (5, "6", None),
    (5, "6.01", "SATURDAY_HOURS"), (6, "0", "SUNDAY_WORK"), (6, "4", "SUNDAY_WORK"),
])
def test_weekday_and_weekend_boundaries(offset, hours, code):
    limits = {"daily_hours": Decimal(9), "weekly_hours": Decimal(45), "saturday_min_hours": Decimal(4), "saturday_max_hours": Decimal(6)}
    violation = day_hours_violation(date(2026, 10, 19) + timedelta(days=offset), Decimal(hours), limits)
    assert (violation["code"] if violation else None) == code


def test_cadre_activities_and_new_indicators_are_configured(api, db):
    from backend.models import Cadre, CadreFormField
    from backend.services.activities import ACTIVITIES, FIELD_SPECS

    expected = {
        "CHW": "hiv_testing",
        "DATA_CLERK": "ctc_data",
        "HCP": "opd_screening",
    }
    for code, activity_key in expected.items():
        cadre = db.query(Cadre).filter(Cadre.code == code).one()
        assert activity_key in {a["key"] for a in ACTIVITIES[code]}
        keys = {f.key for f in db.query(CadreFormField).filter(CadreFormField.cadre_id == cadre.id)}
        assert all(spec[0] in keys for spec in FIELD_SPECS[code])


def test_selected_activity_limits_measures_and_flags_monthly_funnel(api, period):
    log = api.post("/worklogs", "hcp1", {"period_id": period["id"]})
    entry = api.put(
        f"/worklogs/{log['id']}/entries/{period['start_date']}",
        "hcp1",
        {
            "activity_key": "opd_screening",
            "start_time": "08:00",
            "end_time": "10:00",
            "evidence_text": "OPD screening and testing",
            "measures": {
                "hcp_opd_attendees": 5,
                "hcp_opd_screened": 7,
                "clients_tested_opitc": 8,
                "clients_tested_positive_new": 3,
                "hiv_positive_linked_art": 4,
                "hcp_opd_presumptive_tb": 2,
                "tb_samples_collected": 3,
                "hcp_opd_tb_diagnosed_started": 4,
            },
        },
    )
    assert entry["entries"][0]["activity_key"] == "opd_screening"
    assert entry["review_summary"]["metrics"]["clients_tested_opitc"] == "8.00"
    assert any(flag["code"] == "CASCADE" for flag in entry["review_summary"]["anomalies"])
    assert any(flag["code"] == "MONTHLY_CASCADE" for flag in entry["review_summary"]["anomalies"])
    api.call(
        "PUT",
        f"/worklogs/{log['id']}/entries/{period['start_date']}",
        "hcp1",
        json={
            **ENTRY["HCP"](None),
            "activity_key": "opd_screening",
            "measures": {"ctc_clients_registered": 2},
        },
        expect=422,
    )


def test_daily_weekly_hour_limits_and_backdating_are_enforced(api, period):
    api.put("/admin/settings/max_daily_hours", "admin", {"value": 8.5, "reason": "Test work-hour limits"})
    api.put("/admin/settings/max_weekly_hours", "admin", {"value": 15.0, "reason": "Test work-hour limits"})
    try:
        log = api.post("/worklogs", "chw1", {"period_id": period["id"]})
        first_day = period["start_date"]
        first_date = date.fromisoformat(first_day)
        first_date += timedelta(days=(7 - first_date.weekday()) % 7)
        first_day = str(first_date)
        second_day = str(first_date + timedelta(days=1))
        first = ENTRY["CHW"](first_day)
        api.put(f"/worklogs/{log['id']}/entries/{first_day}", "chw1", first)
        api.put(f"/worklogs/{log['id']}/entries/{second_day}", "chw1", first, expect=422)
        too_long = {**first, "hours_worked": 8.75}
        api.put(f"/worklogs/{log['id']}/entries/{second_day}", "chw1", too_long, expect=422)
    finally:
        api.put("/admin/settings/max_daily_hours", "admin", {"value": 9.0, "reason": "Restore configured limit"})
        api.put("/admin/settings/max_weekly_hours", "admin", {"value": 45.0, "reason": "Restore configured limit"})

    api.put("/admin/settings/backdate_grace_hours", "admin", {"value": 48, "reason": "Test backdating"})
    try:
        today = local_today()
        recent_period = api.post("/admin/pay-periods", "central1", {
            "start_date": str(today - timedelta(days=6)),
            "end_date": str(today),
            "period_label": "Backdate validation",
            "status": "OPEN",
        })
        log = api.post("/worklogs", "chw1", {"period_id": recent_period["id"]})
        old_date = str(today - timedelta(days=3))
        api.put(f"/worklogs/{log['id']}/entries/{old_date}", "chw1", ENTRY["CHW"](old_date), expect=422)
    finally:
        api.put("/admin/settings/backdate_grace_hours", "admin", {"value": 1000000, "reason": "Restore acceptance-test window"})


def test_secondary_facility_requires_a_name_and_complete_indicators(api, period):
    log = api.post("/worklogs", "clerk1", {"period_id": period["id"]})
    body = {
        "activity_key": "secondary_facility", "start_time": "08:00", "end_time": "10:00",
        "evidence_text": "Data entry at supporting facility", "measures": {},
    }
    path = f"/worklogs/{log['id']}/entries/{period['start_date']}"
    api.put(path, "clerk1", body, expect=422)
    saved = api.put(path, "clerk1", {**body, "activity_location": "Supporting clinic"})
    assert saved["entries"][0]["activity_location"] == "Supporting clinic"
    # Drafts may be incomplete, but required activity indicators block submission.
    api.post(f"/worklogs/{log['id']}/actions/submit", "clerk1", {"attest": True}, expect=422)


def test_monthly_summary_combines_visible_logs_across_pay_periods(api, period):
    start = date.fromisoformat(period["start_date"])
    first = api.post("/worklogs", "hcp1", {"period_id": period["id"]})
    api.put(f"/worklogs/{first['id']}/entries/{start}", "hcp1", ENTRY["HCP"](None))
    second_period = api.post("/admin/pay-periods", "central1", {
        "start_date": str(start + timedelta(days=7)), "end_date": str(start + timedelta(days=13)),
        "period_label": "Weekly subperiod", "status": "OPEN",
    })
    second = api.post("/worklogs", "hcp1", {"period_id": second_period["id"]})
    second_day = start + timedelta(days=7)
    api.put(f"/worklogs/{second['id']}/entries/{second_day}", "hcp1", ENTRY["HCP"](None))
    summary = api.get(f"/worklogs/{second['id']}", "hcp1")["review_summary"]["months"][0]
    assert summary["month"] == start.strftime("%Y-%m")
    assert summary["days"] == 2
    assert float(summary["hours"]) == 4


def test_full_weekdays_plus_saturday_clinic_are_allowed_but_sunday_is_not(api, period):
    monday = date.fromisoformat(period["start_date"])
    assert monday.weekday() == 0
    log = api.post("/worklogs", "chw1", {"period_id": period["id"]})
    for offset in range(5):
        body = {**ENTRY["CHW"](None), "hours_worked": 9}
        log = api.put(f"/worklogs/{log['id']}/entries/{monday + timedelta(days=offset)}", "chw1", body)
    saturday = monday + timedelta(days=5)
    body = {**ENTRY["CHW"](None), "hours_worked": 6}
    log = api.put(f"/worklogs/{log['id']}/entries/{saturday}", "chw1", body)
    assert float(log["totals"]["hours"]) == 51
    assert not any(flag["code"] in {"DAILY_HOURS", "WEEKLY_HOURS", "SATURDAY_HOURS", "SUNDAY_WORK"} for flag in log["review_summary"]["anomalies"])
    for invalid_hours in (3.75, 6.25):
        api.put(f"/worklogs/{log['id']}/entries/{saturday}", "chw1", {**body, "hours_worked": invalid_hours}, expect=422)
    api.put(f"/worklogs/{log['id']}/entries/{saturday + timedelta(days=1)}", "chw1", body, expect=422)
    submitted = api.post(f"/worklogs/{log['id']}/actions/submit", "chw1", {"attest": True})
    assert submitted["status"] == "PENDING_CTC_VERIFICATION"


def test_timed_saturday_clinics_and_existing_sunday_entries(api, db, period):
    saturday = date.fromisoformat(period["start_date"]) + timedelta(days=5)
    log = api.post("/worklogs", "hcp1", {"period_id": period["id"]})
    body = {**ENTRY["HCP"](None), "start_time": "08:00", "end_time": "12:00"}
    path = f"/worklogs/{log['id']}/entries/{saturday}"
    saved = api.put(path, "hcp1", body)
    assert float(saved["entries"][0]["hours_worked"]) == 4
    api.put(path, "hcp1", {**body, "end_time": "14:00"})
    api.put(path, "hcp1", {**body, "end_time": "11:45"}, expect=422)
    api.put(path, "hcp1", {**body, "end_time": "14:15"}, expect=422)
    # An old Sunday record is retained for audit, but cannot be resubmitted.
    from backend.models import WorkLogEntry
    db.query(WorkLogEntry).filter(WorkLogEntry.work_log_id == log["id"]).update({"entry_date": saturday + timedelta(days=1)})
    db.commit()
    detail = api.get(f"/worklogs/{log['id']}", "hcp1")
    assert any(flag["code"] == "SUNDAY_WORK" for flag in detail["review_summary"]["anomalies"])
    api.post(f"/worklogs/{log['id']}/actions/submit", "hcp1", {"attest": True}, expect=422)


def test_saturday_settings_cannot_have_inverted_limits(api):
    for key, value in (("saturday_min_hours", 7.0), ("saturday_max_hours", 3.0)):
        result = api.put(f"/admin/settings/{key}", "admin", {"value": value, "reason": "Test invalid weekend bounds"}, expect=422)
        assert "Saturday minimum" in result["detail"]
