"""Data Clerk Services: Weekend Clinics and Secondary facility (its name and the records entered there), and a
Technical Officer stopping a Service such as Outreach services."""
from datetime import date, timedelta

import pytest

from backend.models import ActivityRate, AuditEvent, Staff, StaffAssignment, User
from .test_data_clerk_timesheet import new_workflow  # noqa: F401 (fixture)

SERVICE = "data_clerk_secondary_facility_service"


def _clerk(db):
    staff = db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == "clerk1").one()
    return staff, db.query(StaffAssignment).filter_by(staff_id=staff.id).first()


def _rate(api, db, period, **body):
    staff, assignment = _clerk(db)
    return api.post("/rates", "tofficer1", {"label_en": "Secondary facility", "label_sw": "Kituo cha pili", "cadre_id": staff.cadre_id,
                                            "region_id": assignment.region_id, "item_type": "SERVICES", "form_mode": "SINGLE",
                                            "unit_type": "PER_DAY", "rate_value": 20000, "effective_start_date": period["start_date"],
                                            "min_days_per_month": 0, **body})


def test_secondary_facility_is_a_priced_service_and_a_stopped_service_is_no_longer_offered(api, db, period, new_workflow):
    rate = _rate(api, db, period, template_key=SERVICE)
    assert rate["requires_location"] is True and rate["fields"] == ["dc_secondary_records_entered"]
    log = api.post("/worklogs", "clerk1", {"period_id": period["id"], "work_type": "SERVICES"})
    offered = {a["key"]: a for a in log["cadre"]["activities"]}
    assert rate["key"] in offered and SERVICE not in offered  # the priced version replaces the template
    activity = offered[rate["key"]]
    assert activity["required_fields"] == ["dc_secondary_records_entered"] and activity["requires_location"] is True
    path = f"/worklogs/{log['id']}/entries/{period['start_date']}"
    day = {"activity_key": rate["key"], "start_time": "08:00", "end_time": "12:00", "measures": {"dc_secondary_records_entered": 35}}
    assert "secondary facility" in str(api.put(path, "clerk1", day, expect=422))  # the facility's name is required
    api.put(path, "clerk1", {**day, "activity_location": "Ihanga Dispensary", "measures": {}}, expect=422)  # and the records
    saved = api.put(path, "clerk1", {**day, "activity_location": "Ihanga Dispensary"})
    entry = saved["entries"][0]
    assert entry["activity_location"] == "Ihanga Dispensary" and entry["measures"] == {"dc_secondary_records_entered": 35}

    # A Technical Officer stops a Service (here Outreach services): it is no longer offered. One test and one pay
    # period for both, since the suite has a limited number of past months to give each test its own.
    outreach = _rate(api, db, period, label_en="Outreach services", label_sw="Huduma za mkoba", min_days_per_month=5)
    assert outreach["key"] in {a["key"] for a in api.get(f"/worklogs/{log['id']}", "clerk1")["cadre"]["activities"]}

    api.post(f"/rates/{outreach['id']}/retire", "clerk1", {"reason": "Not a Data Clerk service"}, expect=403)
    api.post(f"/rates/{outreach['id']}/retire", "tofficer1", {"reason": "no"}, expect=422)
    stopped = api.post(f"/rates/{outreach['id']}/retire", "tofficer1", {"reason": "Data Clerks do not do outreach services"})
    assert stopped["is_active"] is False
    api.post(f"/rates/{outreach['id']}/retire", "tofficer1", {"reason": "Data Clerks do not do outreach services"}, expect=409)
    assert db.query(AuditEvent).filter_by(entity_type="activity_rate", entity_id=str(outreach["id"]), action="retire").count() == 1

    later = api.get(f"/worklogs/{log['id']}", "clerk1")  # the same draft, reopened
    assert outreach["key"] not in {a["key"] for a in later["cadre"]["activities"]}
    db.expire_all()
    assert db.get(ActivityRate, outreach["id"]).is_active is False  # kept in the history, not deleted
