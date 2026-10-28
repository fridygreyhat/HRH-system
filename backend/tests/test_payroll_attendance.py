"""Payroll attendance is independent of same-date Services and payment pricing."""
import pytest

from .test_ctc_facility_approval import no_provider_sms
from .test_v22_finance import v22
from .conftest import category_id


@pytest.mark.parametrize("provider", ["chw1", "hcp1", "clerk1"])
def test_same_date_payroll_and_services_have_independent_limits_and_approvals(
    api, db, period, v22, provider,
):
    from backend.models import Staff, StaffAssignment, User
    staff = db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == provider).one()
    assignment = db.query(StaffAssignment).filter_by(staff_id=staff.id).first()
    service = api.post("/rates", "admin", {
        "label_en": "Independent service", "label_sw": "Huduma tofauti",
        "cadre_id": staff.cadre_id, "region_id": assignment.region_id,
        "item_type": "SERVICES", "form_mode": "SINGLE", "unit_type": "PER_HOUR",
        "rate_value": 100, "currency": "TZS", "effective_start_date": period["start_date"],
    })
    payroll = api.post("/worklogs", provider, {"period_id": period["id"], "work_type": "PAYROLL"})
    assert all(not activity["required_fields"] for activity in payroll["cadre"]["activities"])
    assert payroll["cadre"]["fields"] == []
    day = period["start_date"]
    path = f"/worklogs/{payroll['id']}/entries/{day}"
    body = {"activity_key": "daily_attendance", "hours_worked": 8, "measures": {}}
    payroll = api.put(path, provider, body)
    api.put(path, provider, {**body, "hours_worked": 8.01}, expect=422)
    services = api.post("/worklogs", provider, {"period_id": period["id"], "work_type": "SERVICES"})
    services = api.put(f"/worklogs/{services['id']}/entries/{day}", provider, {
        "activity_key": service["key"], "hours_worked": 2,
        "start_time": "17:00", "end_time": "19:00",
        "measures": {key: 3 for key in service["fields"]},
    })
    assert float(services["review_summary"]["months"][0]["hours"]) == 2
    payroll = api.get(f"/worklogs/{payroll['id']}", provider)
    assert float(payroll["review_summary"]["months"][0]["hours"]) == 8
    assert not any(a["code"] in {"DAILY_HOURS", "WEEKLY_HOURS"} for a in payroll["review_summary"]["anomalies"])
    for log in (payroll, services):
        review = {"review_confirmed": True, "review_type": log["work_type"]}
        api.post(f"/worklogs/{log['id']}/actions/submit", provider, {"attest": True})
        api.post(f"/worklogs/{log['id']}/actions/verify", "supervisor1", review)
        api.post(f"/worklogs/{log['id']}/actions/endorse", "tofficer1", review)
        own_queue = api.get(f"/worklogs?queue=true&work_type={log['work_type']}", "rpm1")
        assert log["id"] in {row["id"] for row in own_queue}
        other = "PAYROLL" if log["work_type"] == "SERVICES" else "SERVICES"
        assert log["id"] not in {row["id"] for row in api.get(f"/worklogs?queue=true&work_type={other}", "rpm1")}
        api.post(f"/worklogs/{log['id']}/actions/authorize", "rpm1",
                 {**review, "review_type": other}, expect=422)
        approved = api.post(f"/worklogs/{log['id']}/actions/authorize", "rpm1", review)
        assert approved["status"] == "PENDING_FINANCE_REVIEW"
        if log["work_type"] == "PAYROLL":
            assert approved["approved_at"]
            assert not approved["claims"]  # No invented salary or payable zero-value claim.
        else:
            assert float(approved["claims"][0]["amount"]) == 200
    if provider == "chw1":
        failed = api.post(f"/worklogs/{payroll['id']}/actions/finance_review", v22["finance"], {
            "review_confirmed": True, "review_type": "PAYROLL", "category_id": category_id(db, "B"),
        }, expect=422)
        assert "rate" in failed["detail"]
