"""Services retain fixed daily amounts; monthly regional budgets replace legacy lines."""
from io import BytesIO
import json
import calendar
from datetime import date, timedelta
import pytest

from backend.models import BudgetLine, BudgetTransaction, FundingSource, PaymentClaim, User
from .test_v22_finance import v22
from .test_fixed_daily_services import daily_rate, approve
from .test_finance_monthly_reports import all_cadres
from .test_ctc_facility_approval import no_provider_sms

pytestmark = pytest.mark.usefixtures("no_provider_sms")


@pytest.fixture
def empty_period(api):
    from .conftest import _months, test_month
    year, month, lap = test_month(next(_months))
    first = date(year, month, 1)
    first += timedelta(days=(7 - first.weekday()) % 7 + 7 * lap)
    return api.post("/admin/pay-periods", "central1", {
        "start_date": str(first), "end_date": str(date(year, month, calendar.monthrange(year, month)[1])),
        "period_label": f"Unallocated test {year}-{month:02d}", "status": "OPEN",
    })


@pytest.mark.parametrize("provider", ["chw1", "hcp1", "clerk1"])
def test_every_cadre_uses_monthly_budget_not_legacy_category_allocations(api, db, empty_period, v22, provider):
    period = empty_period
    for user in (v22["finance"], "tofficer1", "rpm1", "fhifin1", "fhifin2"):
        all_cadres(db, user)
    # The monthly regional ceiling is separate from legacy per-category lines.
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
    assert log["finance_snapshot"]["payment_policy"] == "FIXED_DAILY_MONTHLY_REGIONAL_BUDGET"
    assert log["finance_snapshot"]["budget_line_id"] is None
    assert float(log["finance_snapshot"]["total"]) == 40000
    from .monthly_budget_setup import ensure_monthly_budgets
    ensure_monthly_budgets(db, log["id"], v22["finance"])
    routed = api.post("/finance/channel", v22["finance"], {
        "central_reviewer_id": db.query(User).filter_by(username="fhifin1").one().id,
        **body, "work_log_id": log["id"],
        "target_payor_id": log["finance_snapshot"]["payor_org_id"],
        "expected_review_token": log["finance_snapshot"]["review_token"],
    })
    assert routed["status"] == "ROUTED_FHI360"
    claim_id = routed["claim_id"]
    claim = api.get(f"/claims/{claim_id}", "fhifin1")
    assert claim["status"] == "PENDING_CENTRAL_REVIEW" and claim["amount"] == 40000
    claim = api.post(f"/claims/{claim_id}/actions/central_approve", "fhifin1",
                     {"review_confirmed": True, "expected_amount": claim["amount"]})
    assert claim["status"] == "READY"
    assert claim["payment_manifest"]["services"] == [activity["label_en"]]
    assert claim["payment_manifest"]["provider_name"] == claim["staff_name"]
    api.get(f"/claims/{claim_id}", "csofin1", expect=404)
    names = [{
        "claim_id": claim_id,
        "provider_name": claim["payment_manifest"]["provider_name"],
        "service_names": claim["payment_manifest"]["services"],
        "amount": claim["payment_manifest"]["amount"],
    }]
    headers = {"Authorization": f"Bearer {api.token('fhifin1')}"}
    fields = {"beneficiaries": json.dumps(names), "payment_reference": f"ISOLATED-NO-BUDGET-{provider}",
              "payment_date": period["start_date"], "beneficiaries_confirmed": "true", "payment_method": "BANK"}
    data = BytesIO(b"%PDF-1.4\nSynthetic isolated test proof with provider, service and amount list\n%%EOF")
    response = api.client.post("/claims/services/proof-payment", headers=headers, data=fields,
                               files={"file": ("synthetic-proof.pdf", data, "application/pdf")})
    assert response.status_code == 201, response.text
    assert response.json()["paid_claim_ids"] == [claim_id]
    paid = api.get(f"/claims/{claim_id}", "fhifin1")
    assert paid["payment_status"] == "PAID"
    assert paid["service_names"] == [activity["label_en"]]
    assert paid["payment_actions"] == []  # recorder may not reconcile their own payment
    proof = paid["proofs"][0]["beneficiary_snapshot"]
    assert proof["provider_name"] == claim["staff_name"]
    assert proof["services"] == claim["payment_manifest"]["services"]
    assert proof["claim_amount"] == proof["payment_amount"] == "40000.00"
    assert paid["payments"][0]["amount"] == 40000
    assert paid["payments"][0]["payment_reference"] == fields["payment_reference"]
    duplicate = api.client.post("/claims/services/proof-payment", headers=headers, data=fields,
                                files={"file": ("duplicate.pdf", BytesIO(b"%PDF-1.4\nDuplicate proof\n%%EOF"), "application/pdf")})
    assert duplicate.status_code == 409
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
