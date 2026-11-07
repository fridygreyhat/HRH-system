"""An RM can hold several regions: one list, every row names its region, and the list can be narrowed to one."""
from datetime import date

import pytest

from backend.models import PayPeriod, Region, Staff, StaffAssignment, User, UserScope, WorkLog
from .test_salary_timesheets import temporary


def waiting_for_rm(db, temporary, period, username):
    staff = db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == username).one()
    placement = db.query(StaffAssignment).filter_by(staff_id=staff.id).first()
    temporary(WorkLog(staff_id=staff.id, assignment_id=placement.id, cadre_id=staff.cadre_id, period_id=period.id,
                      workflow_version=2, work_type="PAYROLL", status="PENDING_RPM_AUTHORIZATION"))
    return placement.region_id


@pytest.fixture
def two_regions(db, temporary):
    period = temporary(PayPeriod(start_date=date(2092, 1, 1), end_date=date(2092, 1, 25), status="OPEN", period_label="Two regions"))
    first, second = waiting_for_rm(db, temporary, period, "chw1"), waiting_for_rm(db, temporary, period, "hcp2")
    assert first != second
    rm = db.query(User).filter_by(username="rpm1").one()
    temporary(UserScope(user_id=rm.id, region_id=second))
    return {"first": first, "second": second, "period": period.id}


def queue(api, user, region=None):
    path = "/worklogs?queue=true&work_type=PAYROLL" + (f"&region_id={region}" if region else "")
    return [row for row in api.get(path, user) if row["period_label"] == "Two regions"]


def test_an_rm_with_two_regions_sees_both_in_one_list_with_each_region_named(api, db, two_regions):
    rows = queue(api, "rpm1")
    names = {row["region_id"]: row["region_name"] for row in rows}
    assert names == {two_regions["first"]: db.get(Region, two_regions["first"]).name,
                     two_regions["second"]: db.get(Region, two_regions["second"]).name}


def test_the_list_narrows_to_one_region(api, two_regions):
    assert {row["region_id"] for row in queue(api, "rpm1", two_regions["second"])} == {two_regions["second"]}
    period = two_regions["period"]
    rows = api.get(f"/worklogs?period_id={period}&work_type=PAYROLL&region_id={two_regions['first']}", "rpm1")
    assert {row["region_id"] for row in rows} == {two_regions["first"]}


def test_the_region_choices_are_the_rms_own(api, two_regions):
    assert {two_regions["first"], two_regions["second"]} <= {row["id"] for row in api.get("/worklogs/regions", "rpm1")}
    assert {row["id"] for row in api.get("/worklogs/regions", "rpm2")} == {two_regions["second"]}


def test_choosing_a_region_outside_the_scope_shows_nothing(api, two_regions):
    assert queue(api, "rpm2", two_regions["first"]) == []
