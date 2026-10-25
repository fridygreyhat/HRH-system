"""Data Clerk document coverage, daily/service boundaries and optional notes."""
from datetime import date, timedelta

import pytest

from backend.services.data_clerk_forms import DATA_CLERK_REQUIRED


@pytest.fixture
def new_workflow(monkeypatch, legacy_workflow_default):
    from backend.core import workflow_policy
    monkeypatch.setattr(workflow_policy, "NEW_RECORD_WORKFLOW_VERSION", 2)


def payload_for(log, activity_key, **extra):
    activity = next(a for a in log["cadre"]["activities"] if a["key"] == activity_key)
    types = {f["key"]: f["field_type"] for f in log["cadre"]["fields"]}
    return {
        "activity_key": activity_key, "start_time": "08:00", "end_time": "12:00",
        "measures": {key: False if types[key] == "BOOLEAN" else 0 for key in activity["required_fields"]},
        **extra,
    }


def test_clerk_daily_roles_are_payroll_and_no_evidence_or_comment_required(api, period, new_workflow):
    log = api.post("/worklogs", "clerk1", {"period_id": period["id"], "work_type": "PAYROLL"})
    assert {a["key"] for a in log["cadre"]["activities"]} == {
        "data_clerk_daily_timesheet", "data_clerk_secondary_facility",
    }
    activity = next(a for a in log["cadre"]["activities"] if a["key"] == "data_clerk_daily_timesheet")
    assert len(activity["fields"]) == 24
    assert len(activity["required_fields"]) == 22
    types = {f["key"]: f["field_type"] for f in log["cadre"]["fields"]}
    assert sum(types[key] == "BOOLEAN" for key in activity["required_fields"]) == 4
    assert sum(types[key] == "INTEGER" for key in activity["required_fields"]) == 18
    assert [len(g["fields"]) for g in activity["groups"]] == [9, 3, 6, 4, 2]
    assert set(activity["required_fields"]) == set(DATA_CLERK_REQUIRED)
    assert {"ctc_clients_registered", "ctc_transfers_in",
            "ctc_hvl_requests", "ctc_eid_requests",
            "ctc_hvl_results_received", "ctc_eid_results_received"} <= set(activity["required_fields"])
    assert "ctc_eligible_lists_shared" not in activity["required_fields"]
    path = f"/worklogs/{log['id']}/entries/{period['start_date']}"
    payload = payload_for(log, activity["key"])
    saved = api.put(path, "clerk1", payload)
    assert not saved["entries"][0]["evidence_text"]
    assert not saved["entries"][0]["comment"]
    assert float(saved["entries"][0]["measures"]["ctc_full_backup"]) == 0
    incomplete = dict(payload["measures"]); incomplete.pop("ctc_full_backup")
    api.put(path, "clerk1", {**payload, "measures": incomplete}, expect=422)
    api.put(path, "clerk1", {**payload, "evidence_text": "Older evidence", "comment": "Older comment"})
    saved = api.put(path, "clerk1", payload)
    assert saved["entries"][0]["evidence_text"] == "Older evidence"
    assert saved["entries"][0]["comment"] == "Older comment"


def test_secondary_facility_requires_name_and_still_requires_gps(api, period, new_workflow):
    log = api.post("/worklogs", "clerk1", {"period_id": period["id"], "work_type": "PAYROLL"})
    path = f"/worklogs/{log['id']}/entries/{period['start_date']}"
    payload = payload_for(log, "data_clerk_secondary_facility")
    api.put(path, "clerk1", payload, expect=422)
    payload["activity_location"] = "Secondary test facility"
    api.call("PUT", path, "clerk1", json=payload, capture_location=False, expect=422)
    saved = api.put(path, "clerk1", payload)
    assert saved["entries"][0]["activity_location"] == "Secondary test facility"
    assert saved["entries"][0]["activity_snapshot"]["requires_location"] is True
    assert len(saved["entries"][0]["measures"]) == 22


def test_only_weekend_clinic_service_and_separate_payroll_record(api, period, new_workflow):
    service = api.post("/worklogs", "clerk1", {"period_id": period["id"], "work_type": "SERVICES"})
    assert len(service["cadre"]["activities"]) == 1
    activity = service["cadre"]["activities"][0]
    assert activity["key"] == "data_clerk_weekend_clinic"
    assert activity["label_en"] == "Weekend Clinics"
    assert len(activity["required_fields"]) == 22
    saturday = date.fromisoformat(period["start_date"]) + timedelta(days=5)
    payload = payload_for(service, activity["key"])
    path = f"/worklogs/{service['id']}/entries/{saturday}"
    api.put(path, "clerk1", {**payload, "end_time": "11:00"}, expect=422)
    saved = api.put(path, "clerk1", payload)
    assert float(saved["entries"][0]["hours_worked"]) == 4
    api.put(path, "clerk1", {**payload, "activity_key": "data_clerk_daily_timesheet"}, expect=422)
    payroll = api.post("/worklogs", "clerk1", {"period_id": period["id"], "work_type": "PAYROLL"})
    assert payroll["id"] != service["id"]
    api.put(f"/worklogs/{payroll['id']}/entries/{period['start_date']}", "clerk1",
            payload_for(payroll, "data_clerk_daily_timesheet"))


def test_regional_technical_can_add_later_clerk_services_and_template_rates(api, db, period, new_workflow):
    from backend.models import Staff, StaffAssignment, User
    staff = db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == "clerk1").one()
    assignment = db.query(StaffAssignment).filter_by(staff_id=staff.id).first()
    common = {"label_en": "Approved clerk service", "label_sw": "Huduma ya Data Clerk",
              "cadre_id": staff.cadre_id, "region_id": assignment.region_id,
              "rate_value": 100, "effective_start_date": period["start_date"]}
    added = api.post("/rates", "tofficer1", {
        **common, "item_type": "SERVICES", "form_mode": "SINGLE", "unit_type": "PER_UNIT",
    })
    log = api.post("/worklogs", "clerk1", {"period_id": period["id"], "work_type": "SERVICES"})
    assert added["key"] in {a["key"] for a in log["cadre"]["activities"]}
    template = api.post("/rates", "tofficer1", {
        **common, "item_type": "PAYROLL", "template_key": "data_clerk_secondary_facility",
        # Payroll input mode is SINGLE; the selected template supplies its fields.
        "unit_type": "PER_HOUR", "form_mode": "SINGLE",
    })
    assert template["requires_location"] is True
    assert template["form_mode"] == "CASCADE"
    assert len(template["required_fields"]) == 22
    assert len(template["groups"]) == 5
