"""CHW's full daily sheet, separate clinic service and preservation of old text."""
import pytest


@pytest.fixture
def new_workflow(monkeypatch, legacy_workflow_default):
    from backend.core import workflow_policy
    monkeypatch.setattr(workflow_policy, "NEW_RECORD_WORKFLOW_VERSION", 2)


def test_chw_payroll_keeps_daily_indicators_separate_from_services(api, period, new_workflow):
    log = api.post("/worklogs", "chw1", {"period_id": period["id"], "work_type": "PAYROLL"})
    activities = log["cadre"]["activities"]
    assert {a["key"] for a in activities} == {"chw_daily_timesheet"}
    daily = next(a for a in activities if a["key"] == "chw_daily_timesheet")
    assert len(daily["fields"]) == 14
    assert daily["required_fields"] == daily["fields"]
    assert len(daily["groups"]) == 5
    values = {key: 0 for key in daily["fields"]}
    path = f"/worklogs/{log['id']}/entries/{period['start_date']}"
    payload = {"activity_key": daily["key"], "hours_worked": 4, "measures": values}
    saved = api.put(path, "chw1", payload)
    assert not saved["entries"][0]["evidence_text"]
    assert not saved["entries"][0]["comment"]
    assert all(float(value) == 0 for value in saved["entries"][0]["measures"].values())
    assert saved["entries"][0]["activity_snapshot"]["groups"] == daily["groups"]
    api.put(path, "chw1", {**payload, "measures": {**values, "chw_tb_screened": -1}}, expect=422)
    # Hiding inputs must preserve text already in the historical record.
    api.put(path, "chw1", {**payload, "evidence_text": "Previous evidence", "comment": "Previous comment"})
    saved = api.put(path, "chw1", payload)
    assert saved["entries"][0]["evidence_text"] == "Previous evidence"
    assert saved["entries"][0]["comment"] == "Previous comment"
    api.put(f"/worklogs/{log['id']}", "chw1", {"period_comment": "Previous period note"})
    saved = api.put(f"/worklogs/{log['id']}", "chw1", {"occupation": "CHW"})
    assert saved["period_comment"] == "Previous period note"


def test_chw_services_include_clinics_and_tb_contact_tracing(api, period, new_workflow):
    log = api.post("/worklogs", "chw1", {"period_id": period["id"], "work_type": "SERVICES"})
    service = next(item for item in log["cadre"]["activities"] if item["key"] == "chw_weekend_clinic")
    assert {item["key"] for item in log["cadre"]["activities"]} == {"chw_weekend_clinic", "chw_tb_contact_tracing"}
    assert service["label_en"] == "Special and Weekend Clinics"
    assert service["fields"] == ["chw_special_clinic_expected", "chw_special_clinic_served"]
    field_labels = {f["key"]: f["label_en"] for f in log["cadre"]["fields"]}
    assert [field_labels[key] for key in service["fields"]] == ["Expected Client Attendees", "Clients attended and served"]
    path = f"/worklogs/{log['id']}/entries/{period['start_date']}"
    payload = {"activity_key": service["key"], "hours_worked": 4,
               "measures": {"chw_special_clinic_expected": 10, "chw_special_clinic_served": 9}}
    saved = api.put(path, "chw1", payload)
    assert not saved["entries"][0]["evidence_text"]
    assert float(saved["entries"][0]["measures"]["chw_special_clinic_served"]) == 9
    api.put(path, "chw1", {**payload, "activity_key": "chw_daily_timesheet"}, expect=422)


def test_regional_technical_can_add_chw_services(api, db, period, new_workflow):
    from backend.models import Cadre, Staff, StaffAssignment, User
    cadre = db.query(Cadre).filter_by(code="CHW").one()
    staff = db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == "chw1").one()
    assignment = db.query(StaffAssignment).filter_by(staff_id=staff.id).first()
    service = api.post("/rates", "tofficer1", {
        "label_en": "Additional approved service", "label_sw": "Huduma mpya",
        "cadre_id": cadre.id, "region_id": assignment.region_id, "item_type": "SERVICES",
        "form_mode": "SINGLE", "rate_value": 100, "unit_type": "PER_DAY",
        "effective_start_date": period["start_date"],
    })
    log = api.post("/worklogs", "chw1", {"period_id": period["id"], "work_type": "SERVICES"})
    assert service["key"] in {a["key"] for a in log["cadre"]["activities"]}
    api.put(f"/worklogs/{log['id']}/entries/{period['start_date']}", "chw1", {
        "activity_key": service["key"], "hours_worked": 2,
        "measures": {key: 3 for key in service["fields"]},
    })
