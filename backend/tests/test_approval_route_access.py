"""Every cadre, at every stage: only the right person is asked to act, and Finance sees work only once it is theirs."""
import itertools
from datetime import date, timedelta

import pytest

from backend.core.roles import SUPERVISOR, TECHNICAL_OFFICER
from backend.core.security import hash_password
from backend.models import Cadre, PayPeriod, Role, Staff, StaffAssignment, User, UserReviewCadre, UserRole, UserScope, WorkLog, WorkLogEntry, utcnow
from .conftest import PASSWORD
from .test_finance_monthly_reports import all_cadres
from .test_salary_timesheets import temporary
from .test_v22_finance import v22

PROVIDERS = {"chw1": "CHW", "hcp1": "HCP", "clerk1": "DATA_CLERK"}
AUTHORIZED = {"PENDING_FINANCE_REVIEW", "APPROVED"}


_days = itertools.count()


@pytest.fixture
def route(api, db, v22):
    """Opening a record is audited and audit rows stay, so each test archives its own period rather than deleting logs."""
    all_cadres(db, v22["finance"])
    all_cadres(db, "csofin1")
    start = date(2093, 1, 1) + timedelta(days=2 * next(_days))
    period = PayPeriod(start_date=start, end_date=start + timedelta(days=1), status="OPEN", period_label="Route check")
    db.add(period)
    db.commit()

    def log(provider, kind, status):
        staff = db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == provider).one()
        placement = db.query(StaffAssignment).filter_by(staff_id=staff.id).first()
        row = WorkLog(staff_id=staff.id, assignment_id=placement.id, cadre_id=staff.cadre_id, period_id=period.id, workflow_version=2,
                      work_type=kind, status=status, approved_at=utcnow() if status in AUTHORIZED else None)
        db.add(row)
        db.commit()
        return row

    yield {"log": log, "finance": v22["finance"]}
    db.rollback()
    db.query(WorkLog).filter_by(period_id=period.id).update({"status": "CANCELLED"})
    period.status = "ARCHIVED"
    db.commit()


def in_queue(api, user, log):
    return log.id in {row["id"] for row in api.get(f"/worklogs?queue=true&work_type={log.work_type}", user)}


def actions(api, user, log):
    response = api.client.get(f"/worklogs/{log.id}", headers={"Authorization": f"Bearer {api.token(user)}"})
    return response.json()["available_actions"] if response.status_code == 200 else None


@pytest.mark.parametrize("provider", PROVIDERS)
@pytest.mark.parametrize("kind", ["SERVICES", "PAYROLL"])
@pytest.mark.parametrize("status,owner,action", [
    ("PENDING_CTC_VERIFICATION", "supervisor1", "verify"),
    ("PENDING_TECHNICAL_REVIEW", "tofficer1", "endorse"),
    ("PENDING_RPM_AUTHORIZATION", "rpm1", "authorize"),
])
def test_each_stage_waits_on_one_person_for_every_cadre(api, route, provider, kind, status, owner, action):
    log = route["log"](provider, kind, status)
    for user in ("supervisor1", "facilityic1", "tofficer1", "rpm1", "rpm2", route["finance"]):
        assert in_queue(api, user, log) == (user == owner), user
        assert (action in (actions(api, user, log) or [])) == (user == owner), user


@pytest.mark.parametrize("provider", PROVIDERS)
def test_regional_finance_takes_services_after_rm_for_every_cadre(api, route, provider):
    log = route["log"](provider, "SERVICES", "PENDING_FINANCE_REVIEW")
    assert in_queue(api, route["finance"], log)
    assert "finance_timesheet_approve" in actions(api, route["finance"], log)
    assert not in_queue(api, "rpm1", log)


def test_regional_finance_acts_only_on_the_cadres_granted_to_them(api, db, route):
    user = db.query(User).filter_by(username=route["finance"]).one()
    hcp = db.query(Cadre).filter_by(code="HCP").one()
    db.query(UserReviewCadre).filter_by(user_id=user.id, cadre_id=hcp.id).delete()
    db.commit()
    other, own = route["log"]("hcp1", "SERVICES", "PENDING_FINANCE_REVIEW"), route["log"]("chw1", "SERVICES", "PENDING_FINANCE_REVIEW")
    assert in_queue(api, route["finance"], own) and not in_queue(api, route["finance"], other)
    assert actions(api, route["finance"], other) is None


@pytest.mark.parametrize("provider", PROVIDERS)
def test_rm_approved_payroll_waits_for_regional_finance_approval(api, route, provider):
    # RM's approval ends the reviewers' steps; Regional Finance then approves each Payroll timesheet (or returns it)
    # before signing the region's month and sending it to the CSO. There is still no payment review: Payroll is no claim.
    log = route["log"](provider, "PAYROLL", "APPROVED")
    assert in_queue(api, route["finance"], log)
    finance_actions = actions(api, route["finance"], log)
    assert "finance_timesheet_approve" in finance_actions and "return" in finance_actions
    assert "finance_review" not in finance_actions and not [a for a in finance_actions if a.startswith("route_")]


def test_a_technical_officer_sees_only_their_own_cadre(api, db, route, temporary):
    user = temporary(User(username="route_tech_hcp", full_name="Route HCP", phone="+255700099001", hashed_password=hash_password(PASSWORD), must_change_password=False))
    temporary(UserRole(user_id=user.id, role_id=db.query(Role).filter_by(name=TECHNICAL_OFFICER).one().id))
    region = db.query(StaffAssignment).join(Staff).join(User, User.id == Staff.user_id).filter(User.username == "hcp1").first().region_id
    temporary(UserScope(user_id=user.id, region_id=region))
    temporary(UserReviewCadre(user_id=user.id, cadre_id=db.query(Cadre).filter_by(code="HCP").one().id))
    own, other = route["log"]("hcp1", "PAYROLL", "PENDING_TECHNICAL_REVIEW"), route["log"]("chw1", "PAYROLL", "PENDING_TECHNICAL_REVIEW")
    assert in_queue(api, "route_tech_hcp", own) and not in_queue(api, "route_tech_hcp", other)
    assert actions(api, "route_tech_hcp", other) is None
    assert [row["code"] for row in api.get("/worklogs/cadres", "route_tech_hcp")] == ["HCP"]


@pytest.mark.parametrize("provider", PROVIDERS)
@pytest.mark.parametrize("status", ["PENDING_CTC_VERIFICATION", "PENDING_TECHNICAL_REVIEW", "PENDING_RPM_AUTHORIZATION", "APPROVED"])
def test_facility_in_charge_reads_their_cadres_at_every_stage_and_never_decides(api, route, provider, status):
    log = route["log"](provider, "PAYROLL", status)
    assert actions(api, "facilityic1", log) == []
    assert not in_queue(api, "facilityic1", log)
    assert log.id in {row["id"] for row in api.get(f"/worklogs?work_type=PAYROLL&cadre={PROVIDERS[provider]}", "facilityic1")}


@pytest.fixture
def other_facility_ctc(db):
    """A CTC In-Charge at hcp2's facility, which is not supervisor1's. Opening a record is audited, so the account stays."""
    staff = db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == "hcp2").one()
    facility = db.query(StaffAssignment).filter_by(staff_id=staff.id).first().facility_id
    user = User(username="route_ctc_other", full_name="Route CTC", phone="+255700099002", hashed_password=hash_password(PASSWORD), must_change_password=False)
    db.add(user)
    db.flush()
    db.add(UserRole(user_id=user.id, role_id=db.query(Role).filter_by(name=SUPERVISOR).one().id))
    db.add(UserScope(user_id=user.id, facility_id=facility))
    db.commit()
    return user.username


def test_a_ctc_in_charge_sees_every_cadre_at_their_own_facility_only(api, route, other_facility_ctc):
    own = [route["log"](provider, "PAYROLL", "PENDING_CTC_VERIFICATION") for provider in PROVIDERS]
    other = route["log"]("hcp2", "PAYROLL", "PENDING_CTC_VERIFICATION")
    listed = {row["id"] for row in api.get("/worklogs?work_type=PAYROLL", "supervisor1")}
    assert {log.id for log in own} <= listed and other.id not in listed
    assert all(in_queue(api, "supervisor1", log) for log in own) and not in_queue(api, "supervisor1", other)
    assert actions(api, "supervisor1", other) is None
    assert in_queue(api, other_facility_ctc, other) and "verify" in actions(api, other_facility_ctc, other)
    assert not any(in_queue(api, other_facility_ctc, log) for log in own)
    assert all(actions(api, other_facility_ctc, log) is None for log in own)


def test_a_ctc_in_charge_gets_the_full_timesheet_at_their_facility(api, db, route):
    log = route["log"]("hcp1", "PAYROLL", "PENDING_CTC_VERIFICATION")
    for day in (5, 6, 7):
        db.add(WorkLogEntry(work_log_id=log.id, entry_date=date(2093, 2, day), hours_worked=8, evidence_text="Aggregate counts", activity_key="route_test",
                            activity_snapshot={"key": "route_test", "label_en": "Test", "label_sw": "Jaribio", "item_type": "PAYROLL", "form_mode": "SINGLE",
                                               "fields": [], "required_fields": [], "field_definitions": [], "rate_value": None, "currency": "TZS",
                                               "unit_type": "PER_DAY", "billable_field": None}))
    db.commit()
    detail = api.get(f"/worklogs/{log.id}", "supervisor1")
    assert len(detail["entries"]) == 3 and detail["totals"]["days"] == 3 and float(detail["totals"]["hours"]) == 24
    assert detail["entries"][0]["evidence_text"] == "Aggregate counts"


def test_the_cadre_filter_works_on_the_waiting_list(api, route):
    chw, hcp = route["log"]("chw1", "PAYROLL", "PENDING_RPM_AUTHORIZATION"), route["log"]("hcp1", "PAYROLL", "PENDING_RPM_AUTHORIZATION")
    ids = {row["id"] for row in api.get("/worklogs?queue=true&work_type=PAYROLL&cadre=HCP", "rpm1")}
    assert hcp.id in ids and chw.id not in ids


@pytest.mark.parametrize("status", ["DRAFT", "PENDING_CTC_VERIFICATION", "PENDING_TECHNICAL_REVIEW", "PENDING_RPM_AUTHORIZATION", "RETURNED_TO_PROVIDER"])
@pytest.mark.parametrize("kind", ["SERVICES", "PAYROLL"])
def test_finance_cannot_open_work_before_rm_approves_it(api, route, status, kind):
    log = route["log"]("chw1", kind, status)
    for user in (route["finance"], "fhifin1", "csofin1"):
        assert actions(api, user, log) is None, user


def test_rm_gets_back_routed_work_whose_claim_was_cancelled(api, route):
    log = route["log"]("chw1", "SERVICES", "ROUTED_FHI360")
    assert in_queue(api, "rpm1", log) and "reopen" in actions(api, "rpm1", log)


def test_regional_finance_opens_work_once_rm_has_approved_it(api, route):
    assert actions(api, route["finance"], route["log"]("chw1", "PAYROLL", "APPROVED")) is not None


@pytest.mark.parametrize("kind,status,visible", [
    ("PAYROLL", "APPROVED", False), ("SERVICES", "PENDING_FINANCE_REVIEW", False), ("SERVICES", "PAID", False),
    ("PAYROLL", "ROUTED_CSO", True), ("PAYROLL", "PAID", True),
])
def test_a_cso_opens_a_work_log_only_when_it_is_routed_to_it(api, route, kind, status, visible):
    assert (actions(api, "csofin1", route["log"]("chw1", kind, status)) is not None) == visible
