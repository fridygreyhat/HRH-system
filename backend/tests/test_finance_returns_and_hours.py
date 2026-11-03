"""Cadre-specific Finance corrections and minute-accurate work durations."""
from decimal import Decimal

import pytest

from backend.models import PaymentClaim
from .test_named_central_review import reviewed
from .test_services_without_budgets import empty_period
from .test_v22_finance import v22
from .test_finance_monthly_reports import all_cadres
from .test_ctc_facility_approval import no_provider_sms
from .test_fixed_daily_services import daily_rate

pytestmark = pytest.mark.usefixtures("no_provider_sms")


@pytest.mark.parametrize("provider", ["chw1", "hcp1", "clerk1"])
@pytest.mark.parametrize("finance_reviewed", [False, True])
def test_regional_return_goes_to_cadre_technical_then_rm(api, db, empty_period, v22, provider, finance_reviewed):
    log, _ = reviewed(api, db, empty_period, v22, provider)
    if not finance_reviewed:
        # Exercise the first Finance stage as well as the saved-review stage.
        from backend.models import WorkLog
        row = db.get(WorkLog, log["id"])
        row.status = "PENDING_FINANCE_REVIEW"
        db.commit()
    body = {"review_confirmed": True, "review_type": "SERVICES", "comment": "Please recheck the recorded service counts"}
    result = api.post(f"/worklogs/{log['id']}/actions/return", v22["finance"], body)
    assert result["status"] == "PENDING_TECHNICAL_REVIEW"
    assert result["finance_snapshot"] is None and result["approved_at"] is None
    assert all(claim.status == "CANCELLED" for claim in db.query(PaymentClaim).filter_by(work_log_id=log["id"]))
    assert "endorse" in api.get(f"/worklogs/{log['id']}", "tofficer1")["available_actions"]
    assert "submit" not in api.get(f"/worklogs/{log['id']}", provider)["available_actions"]
    # Provider may not edit while Technical owns the returned review.
    api.put(f"/worklogs/{log['id']}/entries/{empty_period['start_date']}", provider,
            {"activity_key": log["entries"][0]["activity_key"], "hours_worked": 1, "measures": {}}, expect=409)
    technical = api.post(f"/worklogs/{log['id']}/actions/endorse", "tofficer1", body)
    assert technical["status"] == "PENDING_RPM_AUTHORIZATION"
    approved = api.post(f"/worklogs/{log['id']}/actions/authorize", "rpm1", body)
    assert approved["status"] == "PENDING_FINANCE_REVIEW"


def test_regional_reject_goes_to_editable_provider(api, db, empty_period, v22):
    log, _ = reviewed(api, db, empty_period, v22)
    result = api.post(f"/worklogs/{log['id']}/actions/reject", v22["finance"], {
        "review_confirmed": True, "review_type": "SERVICES", "comment": "Correct the dates and resubmit",
    })
    assert result["status"] == "REJECTED"
    assert "submit" in api.get(f"/worklogs/{log['id']}", "chw1")["available_actions"]
    assert result["finance_snapshot"] is None
    assert all(claim.status == "CANCELLED" for claim in db.query(PaymentClaim).filter_by(work_log_id=log["id"]))
    entry = result["entries"][0]
    api.put(f"/worklogs/{log['id']}/entries/{entry['entry_date']}", "chw1", {
        "activity_key": entry["activity_key"], "hours_worked": 1,
        "measures": {key: float(value) for key, value in entry["measures"].items()},
    })
    resubmitted = api.post(f"/worklogs/{log['id']}/actions/submit", "chw1", {"attest": True})
    assert resubmitted["status"] == "PENDING_CTC_VERIFICATION"


@pytest.mark.parametrize("provider", ["hcp1", "clerk1"])
def test_elapsed_minutes_and_daily_totals_are_not_rounded_to_hundredths(api, db, empty_period, v22, provider):
    activity = daily_rate(api, db, empty_period, provider, 40000)
    log = api.post("/worklogs", provider, {"period_id": empty_period["id"], "work_type": "SERVICES"})
    result = api.put(f"/worklogs/{log['id']}/entries/{empty_period['start_date']}", provider, {
        "activity_key": activity["key"], "start_time": "08:00", "end_time": "08:17",
        "measures": {key: 0 for key in activity["fields"]},
    })
    assert abs(Decimal(str(result["totals"]["hours"])) * 60 - Decimal(17)) < Decimal("0.0001")
    assert Decimal(str(result["entries"][0]["hours_worked"])) == Decimal("0.283333")
    api.put(f"/worklogs/{log['id']}/entries/{empty_period['start_date']}", provider, {
        "activity_key": activity["key"], "start_time": "09:00", "end_time": "08:17",
        "measures": {key: 0 for key in activity["fields"]},
    }, expect=422)
