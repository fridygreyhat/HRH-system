"""Acceptance checks for the imported CHW, Data Clerk and HCP activity sheets."""

from datetime import timedelta

import pytest

from backend.core.timeutil import local_today
from .conftest import ENTRY, make_period


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
    invalid = api.call(
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
        second_day = str(__import__("datetime").date.fromisoformat(first_day) + timedelta(days=1))
        first = ENTRY["CHW"](first_day)
        api.put(f"/worklogs/{log['id']}/entries/{first_day}", "chw1", first)
        api.put(f"/worklogs/{log['id']}/entries/{second_day}", "chw1", first, expect=422)
        too_long = {**first, "hours_worked": 8.75}
        api.put(f"/worklogs/{log['id']}/entries/{second_day}", "chw1", too_long, expect=422)
    finally:
        api.put("/admin/settings/max_daily_hours", "admin", {"value": 8.5, "reason": "Restore configured limit"})
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
