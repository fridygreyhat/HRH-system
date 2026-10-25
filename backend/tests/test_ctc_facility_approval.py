"""CTC verification covers all facility cadres, separately for Services and Payroll."""
import pytest


@pytest.fixture(autouse=True)
def no_provider_sms(api):
    previous = api.get("/auth/me", "chw1")["client_settings"]["provider_otp_required"]
    api.put("/admin/settings/provider_otp_required", "admin", {"value": False, "reason": "Test current no-SMS CTC workflow"})
    try:
        yield
    finally:
        api.put("/admin/settings/provider_otp_required", "admin", {"value": previous, "reason": "Restore test policy"})


def submitted_log(api, db, period, provider, work_type):
    from backend.models import Staff, StaffAssignment, User
    staff = db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == provider).one()
    assignment = db.query(StaffAssignment).filter_by(staff_id=staff.id).first()
    activity = api.post("/rates", "admin", {
        "label_en": "Synthetic facility approval activity",
        "label_sw": "Shughuli ya majaribio",
        "cadre_id": staff.cadre_id, "region_id": assignment.region_id,
        "item_type": work_type, "form_mode": "SINGLE",
        "rate_value": 100, "currency": "TZS",
        "unit_type": "PER_HOUR" if work_type == "PAYROLL" else "PER_UNIT",
        "effective_start_date": period["start_date"],
    })
    log = api.post("/worklogs", provider, {"period_id": period["id"], "work_type": work_type})
    api.put(f"/worklogs/{log['id']}/entries/{period['start_date']}", provider, {
        "activity_key": activity["key"], "hours_worked": 2, "start_time": "08:00", "end_time": "10:00",
        "measures": {key: 3 for key in activity["fields"]},
    })
    return api.post(f"/worklogs/{log['id']}/actions/submit", provider, {"attest": True})


@pytest.mark.parametrize("provider", ["chw1", "hcp1", "clerk1"])
@pytest.mark.parametrize("work_type", ["SERVICES", "PAYROLL"])
def test_ctc_sees_and_verifies_each_own_facility_cadre(api, db, period, monkeypatch, provider, work_type):
    from backend.core import workflow_policy
    monkeypatch.setattr(workflow_policy, "NEW_RECORD_WORKFLOW_VERSION", 2)
    log = submitted_log(api, db, period, provider, work_type)
    assert log["status"] == "PENDING_CTC_VERIFICATION"
    rows = api.get(f"/worklogs?queue=true&work_type={work_type}", "supervisor1")
    assert log["id"] in {row["id"] for row in rows}
    assert log["id"] not in {
        row["id"] for row in api.get(
            f"/worklogs?queue=true&work_type={'PAYROLL' if work_type == 'SERVICES' else 'SERVICES'}",
            "supervisor1",
        )
    }
    opened = api.get(f"/worklogs/{log['id']}", "supervisor1")
    assert "verify" in opened["available_actions"]
    assert "endorse" not in opened["available_actions"] and "authorize" not in opened["available_actions"]
    result = api.post(f"/worklogs/{log['id']}/actions/verify", "supervisor1", {
        "review_confirmed": True, "review_type": work_type, "expected_version": log["version"],
    })
    assert result["status"] == "PENDING_TECHNICAL_REVIEW"
    assert log["id"] not in {row["id"] for row in api.get("/worklogs?queue=true", "supervisor1")}
    api.post(f"/worklogs/{log['id']}/actions/verify", "supervisor1", {
        "review_confirmed": True, "review_type": work_type,
    }, expect=403)


@pytest.mark.parametrize("work_type", ["SERVICES", "PAYROLL"])
def test_ctc_cannot_list_open_or_verify_another_facility(api, db, period, monkeypatch, work_type):
    from backend.core import workflow_policy
    monkeypatch.setattr(workflow_policy, "NEW_RECORD_WORKFLOW_VERSION", 2)
    log = submitted_log(api, db, period, "hcp2", work_type)
    for query in ("", "?queue=true", f"?queue=true&work_type={work_type}", "?cadre=HCP"):
        assert log["id"] not in {row["id"] for row in api.get("/worklogs" + query, "supervisor1")}
    api.get(f"/worklogs/{log['id']}", "supervisor1", expect=404)
    api.post(f"/worklogs/{log['id']}/actions/verify", "supervisor1", {
        "review_confirmed": True, "review_type": work_type,
    }, expect=404)
    # This is a visible, submitted record for its own region, not a missing ID.
    assert api.get(f"/worklogs/{log['id']}", "rpm2")["id"] == log["id"]
