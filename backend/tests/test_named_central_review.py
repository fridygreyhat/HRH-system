"""New Services handoffs require an eligible named reviewer and explicit approval."""
from io import BytesIO

import pytest

from backend.models import ClaimAudit, FundingSource, PaymentClaim, User, UserReviewCadre
from .test_services_without_budgets import empty_period
from .test_v22_finance import v22
from .test_fixed_daily_services import daily_rate, approve
from .test_finance_monthly_reports import all_cadres
from .test_ctc_facility_approval import no_provider_sms

pytestmark = pytest.mark.usefixtures("no_provider_sms")


def reviewed(api, db, period, context, provider="chw1"):
    for username in (context["finance"], "tofficer1", "rpm1", "fhifin1", "fhifin2"):
        all_cadres(db, username)
    activity = daily_rate(api, db, period, provider, 40000)
    log = api.post("/worklogs", provider, {"period_id": period["id"], "work_type": "SERVICES"})
    api.put(f"/worklogs/{log['id']}/entries/{period['start_date']}", provider, {
        "activity_key": activity["key"], "hours_worked": 2, "start_time": "08:00", "end_time": "10:00",
        "measures": {key: 3 for key in activity["fields"]},
    })
    approve(api, provider, log)
    source = db.query(FundingSource).filter_by(name="PnP").one()
    log = api.post(f"/worklogs/{log['id']}/actions/finance_review", context["finance"], {
        "review_confirmed": True, "review_type": "SERVICES", "funding_source_id": source.id,
    })
    return log, {
        "work_log_id": log["id"], "target_payor_id": log["finance_snapshot"]["payor_org_id"],
        "review_confirmed": True, "review_type": "SERVICES", "expected_version": log["version"],
        "expected_review_token": log["finance_snapshot"]["review_token"],
        "central_reviewer_id": db.query(User).filter_by(username="fhifin1").one().id,
    }


@pytest.mark.parametrize("provider", ["chw1", "hcp1", "clerk1"])
def test_only_selected_central_can_approve_before_payment(api, db, empty_period, v22, provider):
    log, body = reviewed(api, db, empty_period, v22, provider)
    candidates = api.get(f"/finance/central-reviewers?work_log_id={log['id']}", v22["finance"])
    assert body["central_reviewer_id"] in {row["id"] for row in candidates}
    api.get(f"/finance/central-reviewers?work_log_id={log['id']}", provider, expect=403)
    api.post("/finance/channel", v22["finance"], {key: value for key, value in body.items() if key != "central_reviewer_id"}, expect=422)
    invalid = db.query(User).filter_by(username="tofficer1").one().id
    api.post("/finance/channel", v22["finance"], {**body, "central_reviewer_id": invalid}, expect=422)
    result = api.post("/finance/channel", v22["finance"], body)
    assert result["claim_status"] == "PENDING_CENTRAL_REVIEW"
    cid = result["claim_id"]
    claim = api.get(f"/claims/{cid}", "fhifin1")
    assert claim["central_reviewer_id"] == body["central_reviewer_id"]
    assert claim["central_reviewer_name"] and claim["central_reviewed_at"] is None
    assert "central_approve" in claim["available_actions"]
    assert claim["payment_actions"] == [] and claim["payment_manifest"] is None
    other = api.get(f"/claims/{cid}", "fhifin2")
    assert "central_approve" not in other["available_actions"]
    confirmed = {"review_confirmed": True, "expected_amount": 40000}
    for username in ("fhifin2", v22["finance"], "rpm1", "admin"):
        api.post(f"/claims/{cid}/actions/central_approve", username, confirmed, expect=403)
    api.post(f"/claims/{cid}/actions/central_approve", "fhifin1", {}, expect=422)
    api.post(f"/claims/{cid}/actions/central_approve", "fhifin1", {**confirmed, "expected_amount": 1}, expect=409)
    api.post(f"/claims/{cid}/payments", "fhifin1", {
        "amount": 40000, "payment_reference": "ISOLATED-NOT-A-PAYMENT",
        "payment_date": empty_period["start_date"], "payment_method": "BANK",
    }, expect=409)
    response = api.client.post(f"/claims/{cid}/proofs", headers={"Authorization": f"Bearer {api.token('fhifin1')}"},
                              files={"file": ("test.pdf", BytesIO(b"%PDF-1.4\nTest\n%%EOF"), "application/pdf")})
    assert response.status_code == 409
    claim = api.post(f"/claims/{cid}/actions/central_approve", "fhifin1", confirmed)
    assert claim["status"] == "READY" and claim["central_reviewed_at"]
    assert claim["amount"] == 40000 and claim["payment_status"] == "NOT_STARTED"
    assert "record_payment" in claim["payment_actions"]
    api.post(f"/claims/{cid}/actions/central_approve", "fhifin1", confirmed, expect=403)
    assert db.query(ClaimAudit).filter_by(claim_id=cid, action="central_approve").count() == 1


def test_inactive_or_out_of_scope_reviewer_cannot_be_assigned_or_approve(api, db, empty_period, v22):
    log, body = reviewed(api, db, empty_period, v22)
    user = db.query(User).filter_by(username="fhifin1").one()
    user.is_active = False
    db.commit()
    try:
        api.post("/finance/channel", v22["finance"], body, expect=422)
    finally:
        user.is_active = True
        db.commit()
    api.post("/finance/channel", v22["finance"], body)
    scope = db.query(UserReviewCadre).filter_by(user_id=user.id, cadre_id=v22["cadre_id"]).one()
    db.delete(scope)
    db.commit()
    try:
        cid = db.query(PaymentClaim).filter_by(work_log_id=log["id"]).one().id
        api.post(f"/claims/{cid}/actions/central_approve", "fhifin1",
                 {"review_confirmed": True, "expected_amount": 40000}, expect=404)
        assert db.get(PaymentClaim, cid).status == "PENDING_CENTRAL_REVIEW"
    finally:
        db.add(UserReviewCadre(user_id=user.id, cadre_id=v22["cadre_id"]))
        db.commit()
