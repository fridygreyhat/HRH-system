"""One fixed service payment per provider-date; safe Super Admin period deletion."""
from datetime import date, timedelta

import pytest

from .test_v22_finance import v22, route_log
from .test_ctc_facility_approval import no_provider_sms


def daily_rate(api, db, period, provider, amount=100):
    from backend.models import Staff, StaffAssignment, User
    staff = db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == provider).one()
    assignment = db.query(StaffAssignment).filter_by(staff_id=staff.id).first()
    return api.post("/rates", "admin", {
        "label_en": f"Fixed service {amount}", "label_sw": f"Huduma {amount}",
        "cadre_id": staff.cadre_id, "region_id": assignment.region_id,
        "item_type": "SERVICES", "form_mode": "SINGLE", "unit_type": "PER_DAY",
        "rate_value": amount, "currency": "TZS", "effective_start_date": period["start_date"],
    })


def service_measures(activity, count=7):
    return {key: count for key in activity["fields"]}


def approve(api, provider, log):
    body = {"review_confirmed": True, "review_type": "SERVICES"}
    api.post(f"/worklogs/{log['id']}/actions/submit", provider, {"attest": True})
    api.post(f"/worklogs/{log['id']}/actions/verify", "supervisor1", body)
    api.post(f"/worklogs/{log['id']}/actions/endorse", "tofficer1", body)
    return api.post(f"/worklogs/{log['id']}/actions/authorize", "rpm1", body)


@pytest.mark.parametrize("provider", ["chw1", "hcp1", "clerk1"])
def test_multiple_services_pay_highest_once_per_day(api, db, period, v22, provider):
    rates = [daily_rate(api, db, period, provider, amount) for amount in (100, 250, 150)]
    log = api.post("/worklogs", provider, {"period_id": period["id"], "work_type": "SERVICES"})
    day = period["start_date"]
    body = {
        "activity_key": rates[0]["key"], "hours_worked": 4,
        "start_time": "08:00", "end_time": "12:00", "measures": service_measures(rates[0]),
        "additional_services": [{"activity_key": rate["key"], "measures": service_measures(rate)} for rate in rates[1:]],
    }
    log = api.put(f"/worklogs/{log['id']}/entries/{day}", provider, body)
    assert len(log["entries"][0]["activity_snapshot"]["additional_services"]) == 2
    assert float(log["financial_preview"]["total"]) == 250
    assert len(log["financial_preview"]["lines"]) == 1
    assert log["financial_preview"]["lines"][0]["activity"] == rates[1]["label_en"]
    assert float(log["totals"]["hours"]) == 4  # Hours not counted three times.
    for rate in rates:
        for key in rate["fields"]:
            assert float(log["totals"]["measures"][key]) == 7
            assert float(log["review_summary"]["months"][0]["metrics"][key]) == 7
    # Client cannot repeat a service to collect multiple payments.
    api.put(f"/worklogs/{log['id']}/entries/{day}", provider, {
        **body, "additional_services": [{"activity_key": rates[0]["key"], "measures": service_measures(rates[0])}],
    }, expect=422)
    # Saved definitions stay immutable when the scoped amount is revised.
    api.post(f"/rates/{rates[1]['id']}/revise", "admin", {
        "rate_value": 999, "effective_start_date": day,
    })
    log = api.put(f"/worklogs/{log['id']}/entries/{day}", provider, body)
    assert float(log["financial_preview"]["total"]) == 250
    next_day = str(date.fromisoformat(day) + timedelta(days=1))
    log = api.put(f"/worklogs/{log['id']}/entries/{next_day}", provider, {
        **body, "activity_key": rates[2]["key"], "measures": service_measures(rates[2], 100),
        "additional_services": [],
    })
    assert float(log["financial_preview"]["total"]) == 400
    log = approve(api, provider, log)
    claim = api.get(f"/claims/{log['claims'][0]['id']}", "rpm1")
    assert float(claim["amount"]) == 400
    assert len(claim["components"]) == 2
    assert all(float(component["units"]) == 1 for component in claim["components"])
    if provider == "chw1":
        routed = route_log(api, db, v22, log, "A")
        assert float(routed["claims"][0]["amount"]) == 400


def test_missing_or_invalid_additional_service_cannot_create_a_payable_claim(api, db, period, v22):
    rate = daily_rate(api, db, period, "chw1")
    log = api.post("/worklogs", "chw1", {"period_id": period["id"], "work_type": "SERVICES"})
    path = f"/worklogs/{log['id']}/entries/{period['start_date']}"
    body = {"activity_key": rate["key"], "hours_worked": 2, "measures": service_measures(rate)}
    other = daily_rate(api, db, period, "chw1", 200)
    for invalid in (
        {"activity_key": other["key"], "measures": {}},
        {"activity_key": other["key"], "measures": service_measures(other, -1)},
        {"activity_key": "not-a-service", "measures": {}},
    ):
        api.put(path, "chw1", {**body, "additional_services": [invalid]}, expect=422)
    saved = api.put(path, "chw1", {**body, "additional_services": [{
        "activity_key": "chw_weekend_clinic",
        "measures": {"chw_special_clinic_expected": 5, "chw_special_clinic_served": 4},
    }]})
    assert saved["financial_preview"]["exceptions"]
    review = {"review_confirmed": True, "review_type": "SERVICES"}
    api.post(f"/worklogs/{log['id']}/actions/submit", "chw1", {"attest": True})
    api.post(f"/worklogs/{log['id']}/actions/verify", "supervisor1", review)
    api.post(f"/worklogs/{log['id']}/actions/endorse", "tofficer1", review)
    authorized = api.post(f"/worklogs/{log['id']}/actions/authorize", "rpm1", review)
    assert authorized["status"] == "PENDING_FINANCE_REVIEW"
    from .conftest import category_id
    api.post(f"/worklogs/{log['id']}/actions/finance_review", v22["finance"],
             {**review, "category_id": category_id(db, "A")}, expect=422)
    assert not api.get(f"/worklogs/{log['id']}", "chw1")["claims"]


def test_new_rates_are_services_fixed_per_day_only(api, db, period, v22):
    rate = daily_rate(api, db, period, "chw1")
    payload = {key: rate[key] for key in (
        "label_en", "label_sw", "cadre_id", "region_id", "item_type",
        "form_mode", "unit_type", "rate_value", "currency", "effective_start_date",
    )}
    for unit in ("PER_HOUR", "PER_UNIT"):
        api.post("/rates", "admin", {**payload, "unit_type": unit}, expect=422)
    api.post("/rates", "admin", {**payload, "item_type": "PAYROLL", "unit_type": "PER_HOUR"}, expect=422)
    assert rate["billable_field"] is None
    api.post("/rates", "tofficer1", {**payload, "region_id": 999999}, expect=403)


def test_another_log_cannot_create_a_second_service_claim_for_the_same_date(api, db, period, v22):
    from backend.models import PayPeriod, WorkLog, WorkLogEntry
    from backend.services.finance_gate import prepare_after_rpm
    from backend.core.security import load_current_user
    from backend.models import User
    from fastapi import HTTPException
    rate = daily_rate(api, db, period, "chw1", 250)
    first = api.post("/worklogs", "chw1", {"period_id": period["id"], "work_type": "SERVICES"})
    api.put(f"/worklogs/{first['id']}/entries/{period['start_date']}", "chw1", {
        "activity_key": rate["key"], "hours_worked": 2, "measures": service_measures(rate),
    })
    approve(api, "chw1", first)
    # Historical/imported overlap must be blocked even if it bypassed normal
    # period-creation and work-log overlap checks.
    original = db.get(WorkLog, first["id"])
    day = date.fromisoformat(period["start_date"])
    other_period = PayPeriod(start_date=day - timedelta(days=1), end_date=day, status="OPEN")
    db.add(other_period)
    db.flush()
    other = WorkLog(staff_id=original.staff_id, assignment_id=original.assignment_id,
                    cadre_id=original.cadre_id, period_id=other_period.id,
                    workflow_version=2, work_type="SERVICES", status="PENDING_RPM_AUTHORIZATION")
    db.add(other)
    db.flush()
    db.add(WorkLogEntry(work_log_id=other.id, entry_date=day, hours_worked=2,
                        activity_key=rate["key"], activity_snapshot=rate, evidence_text=""))
    db.flush()
    actor = load_current_user(db, db.query(User).filter_by(username="rpm1").one())
    with pytest.raises(HTTPException) as error:
        prepare_after_rpm(db, actor, other)
    assert error.value.status_code == 409
    assert "service payment claim already covers" in error.value.detail
    db.rollback()


def test_only_super_admin_can_delete_unused_periods(api, db, period):
    from backend.models import PayPeriod, AuditEvent
    unused = api.post("/admin/pay-periods", "admin", {
        "start_date": "2037-01-01", "end_date": "2037-01-31",
        "period_label": "Unused deletion test", "status": "CLOSED",
    })
    assert unused["can_delete"] is True
    for actor in ("central1", "fhifin1", "tofficer1", "chw1"):
        api.call("DELETE", f"/admin/pay-periods/{unused['id']}", actor, expect=403)
    result = api.call("DELETE", f"/admin/pay-periods/{unused['id']}", "admin")
    assert result["deleted"]
    assert db.get(PayPeriod, unused["id"]) is None
    assert db.query(AuditEvent).filter_by(entity_type="pay-periods", entity_id=str(unused["id"]), action="delete").count() == 1
    api.call("DELETE", f"/admin/pay-periods/{unused['id']}", "admin", expect=404)
    # Even unused budget allocations are financial records; don't cascade-delete.
    api.call("DELETE", f"/admin/pay-periods/{period['id']}", "admin", expect=409)
