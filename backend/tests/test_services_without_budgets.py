"""Current Services routes use approved daily amounts, never allocations."""
from io import BytesIO
import calendar
from datetime import date, timedelta
import pytest

from backend.models import BudgetLine, BudgetTransaction, FundingSource, PaymentClaim
from .test_v22_finance import v22
from .test_fixed_daily_services import daily_rate, approve
from .test_finance_monthly_reports import all_cadres
from .test_ctc_facility_approval import no_provider_sms

pytestmark = pytest.mark.usefixtures("no_provider_sms")


@pytest.fixture
def empty_period(api):
    from .conftest import _months
    n = next(_months)
    year, month = date.today().year - 1 - n // 12, 12 - n % 12
    first = date(year, month, 1)
    first += timedelta(days=(7 - first.weekday()) % 7)
    return api.post("/admin/pay-periods", "central1", {
        "start_date": str(first), "end_date": str(date(year, month, calendar.monthrange(year, month)[1])),
        "period_label": f"Unallocated test {year}-{month:02d}", "status": "OPEN",
    })


@pytest.mark.parametrize("provider", ["chw1", "hcp1", "clerk1"])
def test_every_cadre_routes_and_gets_paid_without_a_budget(api, db, empty_period, v22, provider):
    period = empty_period
    for user in (v22["finance"], "tofficer1", "rpm1", "fhifin1", "fhifin2"):
        all_cadres(db, user)
    # This period has no allocation at all; neither review nor payment may
    # create a line, commitment, hold or spend entry to make the flow succeed.
    assert db.query(BudgetLine).filter_by(period_id=period["id"]).count() == 0
    api.put("/provider-details/me", provider, {"mobile_money_number": "+255700123456"})
    activity = daily_rate(api, db, period, provider, 40000)
    log = api.post("/worklogs", provider, {"period_id": period["id"], "work_type": "SERVICES"})
    log = api.put(f"/worklogs/{log['id']}/entries/{period['start_date']}", provider, {
        "activity_key": activity["key"], "hours_worked": 2,
        "start_time": "08:00", "end_time": "10:00",
        "measures": {key: 3 for key in activity["fields"]},
    })
    assert "hold" not in log["available_actions"]
    log = approve(api, provider, log)
    assert log["status"] == "PENDING_FINANCE_REVIEW"
    source = db.query(FundingSource).filter_by(name="PnP").one()
    body = {"review_confirmed": True, "review_type": "SERVICES", "funding_source_id": source.id}
    log = api.post(f"/worklogs/{log['id']}/actions/finance_review", v22["finance"], body)
    assert log["finance_snapshot"]["payment_policy"] == "FIXED_DAILY_NO_BUDGET"
    assert log["finance_snapshot"]["budget_line_id"] is None
    assert float(log["finance_snapshot"]["total"]) == 40000
    routed = api.post("/finance/channel", v22["finance"], {
        **body, "work_log_id": log["id"],
        "target_payor_id": log["finance_snapshot"]["payor_org_id"],
        "expected_review_token": log["finance_snapshot"]["review_token"],
    })
    assert routed["status"] == "ROUTED_FHI360"
    claim_id = routed["claim_id"]
    claim = api.get(f"/claims/{claim_id}", "fhifin1")
    assert claim["status"] == "READY" and claim["amount"] == 40000
    api.get(f"/claims/{claim_id}", "csofin1", expect=404)
    paid = api.post(f"/claims/{claim_id}/payments", "fhifin1", {
        "amount": 40000, "payment_reference": f"ISOLATED-NO-BUDGET-{provider}",
        "payment_date": period["start_date"],
    })
    assert paid["payment_status"] == "PROOF_REQUIRED"
    response = api.client.post(
        f"/claims/{claim_id}/proofs", headers={"Authorization": f"Bearer {api.token('fhifin1')}"},
        files={"file": ("synthetic-proof.pdf", BytesIO(b"%PDF-1.4\nSynthetic isolated test proof\n%%EOF"), "application/pdf")},
    )
    assert response.status_code == 201, response.text
    paid = api.post(f"/claims/{claim_id}/actions/confirm_paid", "fhifin2")
    assert paid["payment_status"] == "PAID"
    api.post(f"/claims/{claim_id}/actions/reconcile", "fhifin1",
             {"comment": "Payment recorder must not reconcile"}, expect=403)
    reconciled = api.post(f"/claims/{claim_id}/actions/reconcile", "fhifin2",
                          {"comment": "Synthetic payment matched in isolated test"})
    assert reconciled["payment_status"] == "RECONCILED"
    assert api.get(f"/worklogs/{log['id']}", provider)["status"] == "PAID"
    db.expire_all()
    assert db.get(PaymentClaim, claim_id).budget_line_id is None
    assert db.query(BudgetTransaction).filter_by(claim_id=claim_id).count() == 0
    assert db.query(BudgetLine).filter_by(period_id=period["id"]).count() == 0
