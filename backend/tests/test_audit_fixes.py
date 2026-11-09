"""Each test pins a defect found in the whole-system review, so it cannot quietly return."""
import itertools
from datetime import date, timedelta
from decimal import Decimal
from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.api.endpoints import pay_periods
from backend.core.security import hash_password, load_current_user
from backend.models import (AuditEvent, PayPeriod, Role, SMSOutbox, Staff, StaffAssignment, User, UserRole, WorkLog, WorkLogEntry, utcnow)
from backend.replit_app import LOGIN_LIMIT, LOGIN_WINDOW_SECONDS, too_many_logins
from backend.services import community_claims, notifications, payments, salary_timesheets, services_finance_exports as exports, staff_registry
from backend.services.forms import review_summary
from backend.services.monthly_service_budgets import pay_month_of
from backend.services.service_targets import days_by_service
from backend.services.work_hours import HOUR_POLICY_CODES
from .conftest import PASSWORD
from .test_salary_timesheets import temporary

_days = itertools.count()
SNAPSHOT = {"key": "audit_fix", "label_en": "Audit fix service", "label_sw": "Huduma", "item_type": "PAYROLL", "form_mode": "SINGLE", "fields": [],
            "required_fields": [], "field_definitions": [], "rate_value": None, "currency": "TZS", "unit_type": "PER_DAY", "billable_field": None}


def monday(day):
    return day + timedelta(days=(7 - day.weekday()) % 7)


@pytest.fixture
def chw(db):
    staff = db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == "chw1").one()
    return SimpleNamespace(staff=staff, placement=db.query(StaffAssignment).filter_by(staff_id=staff.id).first())


@pytest.fixture
def periods(db):
    made = []

    def period(status="OPEN"):
        start = date(2088, 1, 3) + timedelta(days=10 * next(_days))
        row = PayPeriod(start_date=start, end_date=start + timedelta(days=8), status=status, period_label="Audit fix")
        db.add(row)
        db.commit()
        made.append(row)
        return row

    yield period
    db.rollback()
    for row in made:
        db.query(WorkLog).filter_by(period_id=row.id).update({"status": "CANCELLED"})
        row.status = "ARCHIVED"
    db.commit()


def worklog(db, chw, period, kind="PAYROLL", status="DRAFT", hours=8, day=None):
    log = WorkLog(staff_id=chw.staff.id, assignment_id=chw.placement.id, cadre_id=chw.staff.cadre_id, period_id=period.id, workflow_version=2, work_type=kind, status=status)
    db.add(log)
    db.flush()
    db.add(WorkLogEntry(work_log_id=log.id, entry_date=day or monday(period.start_date), hours_worked=hours, evidence_text="Counts", activity_key="audit_fix", activity_snapshot=SNAPSHOT))
    db.commit()
    return log


def hour_flags(db, log):
    return [flag for flag in review_summary(db, log)["anomalies"] if flag["code"] in HOUR_POLICY_CODES]


@pytest.mark.parametrize("gone", ["archive", "cancel"])
def test_archived_or_cancelled_work_no_longer_counts_towards_hours(db, chw, periods, gone):
    old = periods()
    fresh_period = periods()
    day = monday(fresh_period.start_date)
    earlier = worklog(db, chw, old, kind="SERVICES", day=day)
    fresh = worklog(db, chw, fresh_period, kind="SERVICES", day=day)
    assert hour_flags(db, fresh)  # control: both live logs do exceed the day
    if gone == "archive":
        old.status = "ARCHIVED"
    else:
        earlier.status = "CANCELLED"
    db.commit()
    assert not hour_flags(db, fresh)


def test_archived_days_no_longer_count_towards_service_minimums(db, chw, periods):
    old = periods()
    day = monday(old.start_date)
    fresh_period = periods()
    worklog(db, chw, old, kind="SERVICES", day=day)
    fresh = worklog(db, chw, fresh_period, kind="SERVICES", day=day + timedelta(days=1))
    assert len(days_by_service(db, fresh, day, day + timedelta(days=1))["Audit fix service"]) == 2  # control
    old.status = "ARCHIVED"
    db.commit()
    assert days_by_service(db, fresh, day, day + timedelta(days=1))["Audit fix service"] == {day + timedelta(days=1)}


def test_saving_a_day_ignores_archived_hours_on_that_date(api, db, chw, periods, monkeypatch):
    old = periods()
    fresh_period = periods()
    day = monday(fresh_period.start_date)
    worklog(db, chw, old, day=day, hours=8)
    log = worklog(db, chw, fresh_period, day=day + timedelta(days=1), hours=2)
    monkeypatch.setattr("backend.api.endpoints.worklogs.local_today", lambda: fresh_period.end_date)
    monkeypatch.setattr("backend.api.endpoints.worklogs.resolve_activity", lambda *_: {**SNAPSHOT, "hours_input": True})
    body = {"activity_key": "audit_fix", "hours_worked": 8, "evidence_text": "Counts", "measures": {}, "gps_lat": -7.77, "gps_lon": 35.69, "gps_accuracy_m": 20}
    headers = {"Authorization": f"Bearer {api.token('chw1')}"}
    assert api.client.put(f"/worklogs/{log.id}/entries/{day}", headers=headers, json=body).status_code == 422  # control: 16 hours in one day
    old.status = "ARCHIVED"
    db.commit()
    assert api.client.put(f"/worklogs/{log.id}/entries/{day}", headers=headers, json=body).status_code == 200


def test_a_cancelled_timesheet_comes_back_as_a_draft_instead_of_blocking_the_month(api, db, chw, periods, monkeypatch):
    period = periods()
    log = worklog(db, chw, period, status="CANCELLED")
    monkeypatch.setattr("backend.api.endpoints.worklogs.local_today", lambda: period.end_date)
    monkeypatch.setattr("backend.core.workflow_policy.NEW_RECORD_WORKFLOW_VERSION", 2)
    restored = api.post("/worklogs", "chw1", {"period_id": period.id, "work_type": "PAYROLL"})
    assert (restored["id"], restored["status"]) == (log.id, "DRAFT")


def test_only_returned_work_can_add_days_after_the_period_closes(api, db, chw, periods, monkeypatch):
    period = periods("CLOSED")
    day = monday(period.start_date)
    log = worklog(db, chw, period, status="RETURNED_TO_PROVIDER", day=day)
    monkeypatch.setattr("backend.api.endpoints.worklogs.local_today", lambda: period.end_date)
    response = api.client.put(f"/worklogs/{log.id}/entries/{day + timedelta(days=1)}", headers={"Authorization": f"Bearer {api.token('chw1')}"},
                              json={"activity_key": "audit_fix", "hours_worked": 4, "evidence_text": "Counts", "measures": {}, "gps_lat": -7.77, "gps_lon": 35.69, "gps_accuracy_m": 20})
    assert "reporting period is closed" not in response.text
    log.status = "DRAFT"
    db.commit()
    blocked = api.client.put(f"/worklogs/{log.id}/entries/{day + timedelta(days=2)}", headers={"Authorization": f"Bearer {api.token('chw1')}"},
                             json={"activity_key": "audit_fix", "hours_worked": 4, "evidence_text": "Counts", "measures": {}, "gps_lat": -7.77, "gps_lon": 35.69, "gps_accuracy_m": 20})
    assert blocked.status_code == 409


def test_an_archived_pay_month_is_not_recreated(api, db, monkeypatch, temporary):
    today = date(2092, 6, 10)
    temporary(PayPeriod(start_date=date(2092, 5, 26), end_date=date(2092, 6, 25), status="ARCHIVED", period_label="June 2092"))
    monkeypatch.setattr(pay_periods, "local_today", lambda: today)
    api.get("/admin/pay-periods", "central1")
    assert db.query(PayPeriod).filter(PayPeriod.start_date == date(2092, 5, 26)).count() == 1


def test_a_partial_overlap_does_not_stop_the_pay_month_opening(api, db, monkeypatch, temporary):
    temporary(PayPeriod(start_date=date(2093, 7, 1), end_date=date(2093, 7, 5), status="OPEN", period_label="Short"))
    monkeypatch.setattr(pay_periods, "local_today", lambda: date(2093, 7, 10))
    try:
        api.get("/admin/pay-periods", "central1")
        assert db.query(PayPeriod).filter(PayPeriod.start_date == date(2093, 6, 26)).count() == 1
        assert db.query(AuditEvent).filter_by(action="auto_open").count() >= 1
    finally:
        db.rollback()
        db.query(PayPeriod).filter(PayPeriod.start_date == date(2093, 6, 26)).delete()
        db.commit()


@pytest.mark.parametrize("data,kind,ok", [(b"%PDF-1.4 real", "application/pdf", True), (b"<html>not a pdf", "application/pdf", False),
                                          (b"\x89PNG\r\n\x1a\nreal", "image/png", True), (b"MZ fake", "image/png", False), (b"\xff\xd8\xff real", "image/jpeg", True)])
def test_a_proof_must_really_be_the_file_type_it_claims(tmp_path, monkeypatch, db, data, kind, ok):
    monkeypatch.setattr(payments.config, "UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(payments, "executor_check", lambda *_: None)
    monkeypatch.setattr(payments.cl, "audit", lambda *_, **__: None)
    monkeypatch.setattr(payments.system_audit, "record", lambda *_, **__: None)
    claim = SimpleNamespace(id=1, workflow_version=2, status="READY", route_code="A", payment_status="NOT_STARTED")
    upload = SimpleNamespace(file=BytesIO(data), content_type=kind, filename="x")
    fake = SimpleNamespace(add=lambda *_: None, flush=lambda: None, query=None)
    if ok:
        monkeypatch.setattr(payments, "PaymentProof", lambda **values: SimpleNamespace(id=1, **values))
        assert payments.store_proof(fake, SimpleNamespace(id=1), claim, upload, None).size_bytes == len(data)
    else:
        with pytest.raises(HTTPException) as error:
            payments.store_proof(fake, SimpleNamespace(id=1), claim, upload, None)
        assert error.value.status_code == 415


@pytest.mark.parametrize("claim", [SimpleNamespace(staff_id=7, route_code="A", workflow_version=2), SimpleNamespace(staff_id=7, route_code="B", workflow_version=2)])
def test_nobody_records_or_reconciles_payment_on_their_own_claim(claim):
    assert "your own claim" in payments.executor_check(SimpleNamespace(staff_id=7, roles=set()), claim)
    assert "your own claim" in payments.reconcile_check(None, SimpleNamespace(staff_id=7, roles=set()), claim)


@pytest.mark.parametrize("text", ["HRH: {} approved today", "HRH: {provider:d} approved", "HRH: {provider.x} approved", "HRH: {provider[0]} approved"])
def test_a_template_that_cannot_be_sent_is_refused(text):
    with pytest.raises(HTTPException):
        notifications.validate_template("WORKLOG_APPROVED", text)


def test_a_bad_saved_template_falls_back_and_never_stops_the_action(db, monkeypatch):
    monkeypatch.setattr(notifications, "active_template", lambda *_: (None, "HRH {} broken"))
    row = notifications.enqueue(db, "WORKLOG_APPROVED", None, "+255700000321", period="October")
    db.rollback()
    assert row.message_body and "{}" not in row.message_body


def test_changing_payment_details_alerts_the_registered_phone(api, db):
    before = db.query(SMSOutbox).filter_by(event_name="PAYMENT_DETAILS_CHANGED").count()
    api.put("/provider-details/me", "chw1", {"mobile_money_number": "+255712345670"})
    assert db.query(SMSOutbox).filter_by(event_name="PAYMENT_DETAILS_CHANGED").count() == before + 1


@pytest.mark.parametrize("method,field", [("BANK", "bank_account_number"), ("MOBILE_WALLET", "mobile_money_number")])
def test_an_approved_account_correction_reaches_the_field_that_is_paid(method, field):
    staff = SimpleNamespace(payment_details_updated_at=utcnow(), payment_method=method, payment_account="0099", payment_provider="CRDB",
                            bank_name="Old", bank_account_number="1111", mobile_money_number="+255700000000")
    staff_registry.apply_payment_correction(staff, {"payment_account": "0099"})
    assert getattr(staff, field) == "0099"


def test_an_exited_provider_loses_their_login(api, db, temporary):
    user = temporary(User(username="audit_exit", full_name="Audit Exit", phone="+255700000411", hashed_password=hash_password(PASSWORD), must_change_password=False))
    temporary(UserRole(user_id=user.id, role_id=db.query(Role).filter_by(name="PROVIDER").one().id))
    staff = temporary(Staff(user_id=user.id, cadre_id=db.query(Staff.cadre_id).first()[0], first_name="Audit", last_name="Exit", verified_phone="+255700000411", enrollment_source="MANUAL"))
    current = SimpleNamespace(id=1, username="x", roles=set(), staff_id=None)
    monkey = staff_registry.system_audit.record
    staff_registry.system_audit.record = lambda *_, **__: None
    try:
        staff_registry.exit_staff(db, current, staff, date(2020, 1, 1), "Left")
    finally:
        staff_registry.system_audit.record = monkey
    db.commit()
    assert db.get(User, user.id).is_active is False


def test_someone_who_has_left_cannot_edit_work_or_payment_details(api, db, chw, periods):
    period = periods()
    log = worklog(db, chw, period)
    staff = db.get(Staff, chw.staff.id)
    staff.status, staff.employment_end_date = "EXITED", date(2020, 1, 1)
    db.commit()
    try:
        headers = {"Authorization": f"Bearer {api.token('chw1')}"}
        assert api.client.put(f"/worklogs/{log.id}/entries/{monday(period.start_date)}", headers=headers, json={"activity_key": "audit_fix", "measures": {}}).status_code == 403
        assert api.client.put("/provider-details/me", headers=headers, json={"mobile_money_number": "+255712345671"}).status_code == 403
    finally:
        staff.status, staff.employment_end_date = "ACTIVE", None
        db.commit()


def test_a_returned_community_claim_stays_correctable_after_the_period_closes(db, chw, periods):
    period = periods("CLOSED")
    current = load_current_user(db, db.query(User).filter_by(username="chw1").one())
    with pytest.raises(HTTPException) as new_claim:
        community_claims.context(db, current, period.id)
    assert "open pay period" in new_claim.value.detail
    try:
        community_claims.context(db, current, period.id, existing=True)
    except HTTPException as error:
        assert "open pay period" not in error.detail


def test_a_provider_on_two_csos_files_is_flagged(monkeypatch):
    monkeypatch.setattr(salary_timesheets, "details", lambda _: {"bank_name": "B", "bank_account_number": "1", "bank_branch": "C"})
    row = {"staff_id": 1, "days": 3, "days_signed": 3, "salary_scale": "A", "other_cso": True, "facility_name": "Clinic"}
    salary_timesheets.with_payment([row], {1: SimpleNamespace(salary_scale="A")}, {"A": Decimal("100")})
    assert salary_timesheets.OTHER_CSO in row["checks"]


def test_a_regional_admin_loses_bank_access_when_a_provider_moves_away(api, db, temporary):
    staff = db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == "hcp2").one()
    iringa = db.query(StaffAssignment).join(Staff).join(User, User.id == Staff.user_id).filter(User.username == "chw1").first().region_id
    temporary(StaffAssignment(staff_id=staff.id, region_id=iringa, start_date=date(2000, 1, 1), end_date=date(2000, 2, 1)))
    assert api.get(f"/staff/{staff.id}", "regadmin1").get("payment_account") is None


def test_an_admin_cannot_link_their_own_account_to_a_staff_record(api, db):
    user = db.query(User).filter_by(username="admin").one()
    staff = db.query(Staff).filter(Staff.user_id.is_(None)).first()
    api.post(f"/admin/users/{user.id}/staff", "admin", {"staff_id": staff.id if staff else 1}, expect=403)


def test_oversight_stays_read_only_on_sms_templates(api):
    api.post("/admin/sms-templates", "oversight1", {"event_name": "WORKLOG_APPROVED", "language": "en", "template_text": "HRH approved {period}"}, expect=403)


@pytest.mark.parametrize("key,value", [("login_lockout_minutes", 10 ** 12), ("login_lockout_minutes", -5), ("login_max_failures", 0)])
def test_settings_that_would_break_sign_in_are_refused(api, key, value):
    api.call("PUT", f"/admin/settings/{key}", "admin", json={"value": value, "reason": "Testing limits"}, expect=422)


def test_payment_file_keeps_mobile_numbers_clean_but_neutralises_formulas():
    row = ["R", "F", "=SUM(A1)", "Svc", 1, 1, "100", "TZS", "+255712345678", 1, "PAID", "", ""]
    text = exports.csv_file([row]).decode("utf-8-sig")
    assert ",+255712345678," in text and "'=SUM(A1)" in text


def test_budget_month_lists_lines_by_pay_month():
    assert pay_month_of(date(2026, 10, 28)) == "2026-11"


def test_sign_in_is_limited_per_address():
    results = [too_many_logins("10.0.0.9", 100.0) for _ in range(LOGIN_LIMIT + 1)]
    assert results[:LOGIN_LIMIT] == [False] * LOGIN_LIMIT and results[-1] is True
    assert too_many_logins("10.0.0.9", 100.0 + LOGIN_WINDOW_SECONDS + 1) is False
