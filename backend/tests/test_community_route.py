"""Community-only providers have no facility, so CSO Technical then FHI360 Technical approve them. CTC In-Charge is facilities only."""
import itertools
from datetime import date, timedelta

import pytest

from backend.core.roles import CSO_TECHNICAL, TECHNICAL_OFFICER
from backend.core.security import hash_password
from backend.models import (Cadre, Organization, PayPeriod, Region, Role, Staff, StaffAssignment, User, UserReviewCadre, UserRole, UserScope,
                            WorkLog, WorkLogAudit)
from backend.services import worklog_workflow as wf
from backend.services.scope import users_in_scope_for
from .conftest import PASSWORD
from .test_ctc_facility_approval import no_provider_sms

pytestmark = pytest.mark.usefixtures("no_provider_sms")
_days = itertools.count()
_people = {}
BODY = {"review_confirmed": True, "review_type": "PAYROLL"}


def person(db, name, role, scopes, cadres):
    user = User(username=name, full_name=name, phone=f"+2557000{len(_people) + 100:05d}", hashed_password=hash_password(PASSWORD), must_change_password=False)
    db.add(user)
    db.flush()
    db.add(UserRole(user_id=user.id, role_id=db.query(Role).filter_by(name=role).one().id))
    db.add_all(UserScope(user_id=user.id, **scope) for scope in scopes)
    db.add_all(UserReviewCadre(user_id=user.id, cadre_id=cadre) for cadre in cadres)
    _people[name] = user.id
    return name


@pytest.fixture
def community(db):
    """A CHW placed in a community area with no facility, and the people around them. Audits stay, so nobody is deleted."""
    if not _people:
        reference = db.query(StaffAssignment).join(Staff).join(User, User.id == Staff.user_id).filter(User.username == "chw1").first()
        cadre = db.query(Staff).filter_by(id=reference.staff_id).one().cadre_id
        other_cadre = db.query(Cadre).filter(Cadre.id != cadre).first().id
        region, org = {"region_id": reference.region_id}, {"organization_id": reference.organization_id}
        other_org = db.query(Organization).filter(Organization.type == "CSO", Organization.id != reference.organization_id).first().id
        other_region = db.query(Region).filter(Region.id != reference.region_id).first().id
        person(db, "comm_cso_tech", CSO_TECHNICAL, [org, region], [cadre])
        person(db, "comm_other_cso", CSO_TECHNICAL, [{"organization_id": other_org}, region], [cadre])
        person(db, "comm_wrong_cadre", CSO_TECHNICAL, [org, region], [other_cadre])
        person(db, "comm_wrong_region", CSO_TECHNICAL, [org, {"region_id": other_region}], [cadre])
        person(db, "comm_fhi_tech", TECHNICAL_OFFICER, [region], [cadre])
        staff = Staff(cadre_id=cadre, first_name="Community", last_name="Only", verified_phone="+255700099777", employment_start_date=date(2000, 1, 1), enrollment_source="MANUAL")
        db.add(staff)
        db.flush()
        db.add(StaffAssignment(staff_id=staff.id, region_id=reference.region_id, organization_id=reference.organization_id,
                               community_area_id=reference.community_area_id, start_date=date(2000, 1, 1)))
        db.commit()
        _people.update(staff=staff.id)
    start = date(2099, 1, 1) + timedelta(days=2 * next(_days))
    period = PayPeriod(start_date=start, end_date=start + timedelta(days=1), status="OPEN", period_label="Community route")
    db.add(period)
    db.commit()

    def log(staff_id=None, status="PENDING_CTC_VERIFICATION"):
        placement = db.query(StaffAssignment).filter_by(staff_id=staff_id or _people["staff"]).first()
        row = WorkLog(staff_id=placement.staff_id, assignment_id=placement.id, cadre_id=db.get(Staff, placement.staff_id).cadre_id, period_id=period.id,
                      workflow_version=2, work_type="PAYROLL", status=status)
        db.add(row)
        db.commit()
        return row

    yield log
    db.rollback()
    db.query(WorkLog).filter_by(period_id=period.id).update({"status": "CANCELLED"})
    period.status = "ARCHIVED"
    db.commit()


def waiting(api, user, log):
    return log.id in {row["id"] for row in api.get("/worklogs?queue=true&work_type=PAYROLL", user)}


def actions(api, user, log):
    response = api.client.get(f"/worklogs/{log.id}", headers={"Authorization": f"Bearer {api.token(user)}"})
    return response.json()["available_actions"] if response.status_code == 200 else None


def test_the_first_step_belongs_to_cso_technical_not_the_ctc_in_charge(api, community):
    log = community()
    assert waiting(api, "comm_cso_tech", log) and "verify" in actions(api, "comm_cso_tech", log)
    assert not waiting(api, "supervisor1", log) and actions(api, "supervisor1", log) is None  # supervisor1 still holds an old community-area scope


@pytest.mark.parametrize("user", ["comm_other_cso", "comm_wrong_cadre", "comm_wrong_region"])
def test_cso_technical_stays_inside_their_cso_cadre_and_region(api, community, user):
    log = community()
    assert not waiting(api, user, log) and actions(api, user, log) is None


def test_community_work_needs_both_technical_approvals_in_order(api, db, community):
    log = community()
    api.post(f"/worklogs/{log.id}/actions/verify", "comm_fhi_tech", BODY, expect=403)
    assert api.post(f"/worklogs/{log.id}/actions/verify", "comm_cso_tech", BODY)["status"] == "PENDING_TECHNICAL_REVIEW"
    db.expire_all()
    assert db.query(WorkLogAudit).filter_by(work_log_id=log.id, action="verify").one().actor_role == CSO_TECHNICAL
    api.post(f"/worklogs/{log.id}/actions/endorse", "comm_cso_tech", BODY, expect=403)
    assert waiting(api, "comm_fhi_tech", log) and not waiting(api, "comm_cso_tech", log)
    assert api.post(f"/worklogs/{log.id}/actions/endorse", "comm_fhi_tech", BODY)["status"] == "PENDING_RPM_AUTHORIZATION"
    assert api.post(f"/worklogs/{log.id}/actions/authorize", "rpm1", BODY)["status"] == "APPROVED"


def test_fhi360_technical_can_send_it_back_to_cso_technical(api, community):
    log = community(status="PENDING_TECHNICAL_REVIEW")
    api.post(f"/worklogs/{log.id}/actions/return_to_reviewer", "comm_fhi_tech", {**BODY, "comment": "Check the days"})
    assert waiting(api, "comm_cso_tech", log) and not waiting(api, "supervisor1", log)


def test_cso_technical_has_nothing_to_do_with_facility_work(api, db, community):
    staff = db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == "chw1").one()
    log = community(staff.id)
    assert not waiting(api, "comm_cso_tech", log) and actions(api, "comm_cso_tech", log) is None
    assert waiting(api, "supervisor1", log) and "verify" in actions(api, "supervisor1", log)


def test_reminders_and_notices_go_to_cso_technical(db, community):
    log = community()
    assignment = db.get(StaffAssignment, log.assignment_id)
    assert wf.stage_owner(db, log) == CSO_TECHNICAL
    names = {user.username for user in users_in_scope_for(db, CSO_TECHNICAL, assignment)}
    assert names == {"comm_cso_tech"}
