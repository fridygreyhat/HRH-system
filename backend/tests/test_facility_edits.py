"""Provider placement correction and shared-facility naming are separate operations."""
from datetime import date

import pytest

from backend.models import AuditEvent, District, Facility, Staff, StaffAssignment, Ward, WorkLog
from backend.tests.test_date_corrections import new_staff


@pytest.fixture
def placement(api, db):
    staff = new_staff(api)
    assignment = db.query(StaffAssignment).filter_by(staff_id=staff["id"]).one()
    ward = db.query(Ward).join(District, District.id == Ward.district_id).filter(
        District.region_id == assignment.region_id
    ).first()
    assert ward
    old = Facility(name=f"Original facility {staff['id']}", ward_id=ward.id, facility_type="PUBLIC",
                   geofence_lat=-8, geofence_lon=35, geofence_radius_meters=1000)
    new = Facility(name=f"New facility {staff['id']}", ward_id=ward.id, facility_type="PUBLIC")
    db.add_all([old, new])
    db.flush()
    assignment.district_id = ward.district_id
    assignment.ward_id = ward.id
    assignment.facility_id = old.id
    db.commit()
    return staff, assignment, old, new


def transfer(api, staff, assignment, facility, effective, actor="admin", expect=None):
    return api.post(f"/staff/{staff['id']}/rotate", actor, {
        "effective_date": effective, "reason": "Correct provider facility",
        "assignment": {"region_id": assignment.region_id, "district_id": assignment.district_id,
                       "ward_id": assignment.ward_id, "facility_name": facility.name},
    }, expect=expect)


def test_correct_unused_placement_on_original_start_date(api, db, placement):
    staff, assignment, old, new = placement
    result = transfer(api, staff, assignment, new, "2026-09-01")
    assert len(result["assignments"]) == 1
    assert result["assignments"][0]["id"] == assignment.id
    assert result["assignments"][0]["facility_id"] == new.id
    assert db.query(AuditEvent).filter_by(entity_type="staff_assignment", entity_id=str(assignment.id),
                                        action="correct_unused_placement").count() == 1
    transfer(api, staff, assignment, old, "2026-09-01", actor="csofin1", expect=403)


def test_used_placement_requires_transfer_and_retains_original_work_log(api, db, period, placement):
    staff, assignment, old, new = placement
    log = WorkLog(staff_id=staff["id"], assignment_id=assignment.id, period_id=period["id"],
                  cadre_id=db.get(Staff, staff["id"]).cadre_id)
    db.add(log)
    db.commit()
    transfer(api, staff, assignment, new, "2026-09-01", expect=409)
    result = transfer(api, staff, assignment, new, "2026-09-15")
    assert len(result["assignments"]) == 2
    db.expire_all()
    assert db.get(WorkLog, log.id).assignment_id == assignment.id
    assert db.get(StaffAssignment, assignment.id).facility_id == old.id
    assert db.get(StaffAssignment, assignment.id).end_date == date(2026, 9, 14)
    current = next(row for row in result["assignments"] if row["end_date"] is None)
    assert current["facility_id"] == new.id


def test_rename_facility_preserves_location_and_blocks_duplicate_names(api, db, placement):
    staff, assignment, old, new = placement
    result = api.call("PATCH", f"/admin/facilities/{old.id}/name", "admin",
                      {"name": "  Corrected   facility name  ", "reason": "Correct spelling"})
    assert result["id"] == old.id
    assert result["name"] == "Corrected facility name"
    assert result["ward_id"] == old.ward_id
    assert float(result["geofence_lat"]) == -8
    assert float(result["geofence_lon"]) == 35
    assert result["geofence_radius_meters"] == 1000
    api.call("PATCH", f"/admin/facilities/{old.id}/name", "admin",
             {"name": new.name, "reason": "Try duplicate name"}, expect=409)
    api.call("PATCH", f"/admin/facilities/{old.id}/name", "csofin1",
             {"name": "Not allowed", "reason": "Attempt shared rename"}, expect=403)
    api.call("PATCH", f"/admin/facilities/{old.id}/name", "admin",
             {"name": "   ", "reason": "Invalid blank name"}, expect=422)
    db.expire_all()
    assert db.get(StaffAssignment, assignment.id).facility_id == old.id
    assert db.query(AuditEvent).filter_by(entity_type="facilities", entity_id=str(old.id), action="rename").count() == 1
