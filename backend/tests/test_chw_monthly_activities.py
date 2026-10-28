"""Synthetic September data verifies reporting without touching real attendance."""
from datetime import date, timedelta

from .test_ctc_facility_approval import no_provider_sms
from backend.services.chw_forms import CHW_GROUPS


def test_chw_can_complete_a_month_and_recover_attendance_only_entries(api, db, monkeypatch):
    from backend.core import workflow_policy
    from backend.models import WorkLogEntry
    monkeypatch.setattr(workflow_policy, "NEW_RECORD_WORKFLOW_VERSION", 2)
    period = next((row for row in api.get("/admin/pay-periods", "admin")
                   if row["start_date"] == "2026-09-01" and row["end_date"] == "2026-09-30" and row["region_id"] is None), None)
    if period is None:
        period = api.post("/admin/pay-periods", "admin", {
            "start_date": "2026-09-01", "end_date": "2026-09-30",
            "period_label": "Synthetic September reporting check", "status": "OPEN",
        })
    log = api.post("/worklogs", "chw1", {"period_id": period["id"], "work_type": "PAYROLL"})
    sheet = next(item for item in log["cadre"]["activities"] if item["key"] == "chw_daily_timesheet")
    assert len(sheet["groups"]) == 5 and len(sheet["required_fields"]) == 14
    counts = {key: 1 for group in CHW_GROUPS for key in group["fields"]}
    root = f"/worklogs/{log['id']}"
    api.put(root + "/entries/2026-09-01", "chw1", {
        "activity_key": "chw_daily_timesheet", "hours_worked": 8, "measures": {},
    }, expect=422)
    api.put(root + "/entries/2026-09-01", "chw1", {
        "activity_key": "chw_daily_timesheet", "hours_worked": 8.5, "measures": counts,
    }, expect=422)
    total_hours = 0
    days = 0
    for offset in range(30):
        day = date(2026, 9, 1) + timedelta(days=offset)
        if day.weekday() == 6:
            continue
        hours = 4 if day.weekday() == 5 else 8
        log = api.put(root + "/entries/" + day.isoformat(), "chw1", {
            "activity_key": "chw_daily_timesheet", "hours_worked": hours, "measures": counts,
        })
        total_hours += hours
        days += 1
    assert len(log["entries"]) == days == 26
    assert log["totals"]["hours"] == total_hours == 192
    assert all(log["totals"]["measures"][key] == 26 for key in counts)
    # Simulate the old saved attendance-only snapshot, with historical terms intact.
    entry = db.query(WorkLogEntry).filter_by(work_log_id=log["id"], entry_date=date(2026, 9, 1)).one()
    entry.activity_key = "daily_attendance"
    entry.activity_snapshot = {
        "key": "daily_attendance", "item_type": "PAYROLL", "fields": [], "required_fields": [],
        "field_definitions": [], "rate_value": "123", "unit_type": "PER_HOUR", "currency": "TZS",
    }
    db.commit()
    old = api.get(root, "chw1")
    recovered = next(item for item in old["cadre"]["activities"] if item["key"] == "daily_attendance")
    assert len(recovered["groups"]) == 5 and len(recovered["fields"]) == 14
    log = api.put(root + "/entries/2026-09-01", "chw1", {
        "activity_key": "daily_attendance", "hours_worked": 8, "measures": {key: 2 for key in counts},
    })
    db.expire_all()
    restored = db.get(WorkLogEntry, entry.id).activity_snapshot
    assert restored["rate_value"] == "123" and restored["unit_type"] == "PER_HOUR"
    assert all(log["totals"]["measures"][key] == 27 for key in counts)
    # Services remain independent of the Payroll activity report.
    services = api.post("/worklogs", "chw1", {"period_id": period["id"], "work_type": "SERVICES"})
    assert all(activity["item_type"] == "SERVICES" for activity in services["cadre"]["activities"])
    assert log["status"] == "DRAFT"
