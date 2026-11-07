"""Central Finance can undo an unpaid Route A export without losing its record."""
import pytest

from backend.models import ClaimAudit, MonthlyServiceBudget, PaymentClaim, PayrollBatch
from .test_claims import _batch_for
from .test_finance_monthly_reports import all_cadres
from .test_named_central_review import reviewed
from .test_services_without_budgets import empty_period
from .test_v22_finance import v22
from .test_ctc_facility_approval import no_provider_sms

pytestmark = pytest.mark.usefixtures("no_provider_sms")
REASON = {"reason": "Wrong provider included"}


def exported(api, db, period, context):
    log, body = reviewed(api, db, period, context)
    claim_id = api.post("/finance/channel", context["finance"], body)["claim_id"]
    api.post(f"/claims/{claim_id}/actions/central_approve", "fhifin1",
             {"review_confirmed": True, "expected_amount": 40000})
    return claim_id, _batch_for(api, "fhifin1", "A", claim_id)


def budget_for(db, period, context):
    return db.query(MonthlyServiceBudget).filter_by(month=period["start_date"][:7], region_id=context["region_id"]).one()


def test_reversal_returns_claims_and_cancelling_restores_the_budget(api, db, empty_period, v22):
    claim_id, batch = exported(api, db, empty_period, v22)
    url = f"/batches/{batch['id']}"
    budget = budget_for(db, empty_period, v22)
    assert budget.deducted_amount == 40000
    assert api.get(url, "fhifin1")["can_reverse"] is True
    assert api.get(f"/claims/{claim_id}", "fhifin1")["status"] == "EXPORTED"
    refused = api.client.post(f"/claims/{claim_id}/actions/cancel", json={"comment": "Blocked until reversed"},
                              headers={"Authorization": f"Bearer {api.token('fhifin1')}"})
    assert refused.status_code == 403 and "Reverse this claim's payment batch" in refused.text

    api.post(f"{url}/reverse", "fhifin1", {}, expect=422)
    api.post(f"{url}/reverse", "fhifin1", {"reason": "   "}, expect=422)
    api.post(f"{url}/reverse", "csofin1", REASON, expect=403)
    reversed_batch = api.post(f"{url}/reverse", "fhifin1", REASON)
    assert reversed_batch["status"] == "REVERSED" and reversed_batch["can_reverse"] is False
    assert reversed_batch["reversal_reason"] == REASON["reason"] and reversed_batch["reversed_at"]
    assert reversed_batch["reversed_by_name"] and reversed_batch["lines"]

    claim = api.get(f"/claims/{claim_id}", "fhifin1")
    assert claim["status"] == "READY" and claim["payment_status"] == "NOT_STARTED" and claim["batch_id"] is None
    entry = db.query(ClaimAudit).filter_by(claim_id=claim_id, action="batch_reversed").one()
    assert entry.comment == REASON["reason"] and entry.details["batch_reference"] == batch["reference"]
    db.refresh(budget)
    assert budget.deducted_amount == 40000  # reversing alone does not refund; cancelling does

    api.post(f"{url}/reverse", "fhifin1", REASON, expect=409)
    api.get(f"{url}/export.csv", "fhifin1", expect=409)
    api.get(f"{url}/export.xlsx", "fhifin1", expect=409)
    api.post(f"/claims/{claim_id}/actions/cancel", "fhifin1", {"comment": "Wrong provider included"})
    db.refresh(budget)
    assert budget.deducted_amount == 0


def test_reversed_claim_can_join_a_new_batch(api, db, empty_period, v22):
    claim_id, batch = exported(api, db, empty_period, v22)
    api.post(f"/batches/{batch['id']}/reverse", "fhifin1", REASON)
    again = _batch_for(api, "fhifin1", "A", claim_id)
    assert again["id"] != batch["id"] and again["status"] == "EXPORTED"
    claim = api.get(f"/claims/{claim_id}", "fhifin1")
    assert claim["status"] == "EXPORTED" and claim["batch_id"] == again["id"]
    assert api.get(f"/batches/{batch['id']}", "fhifin1")["status"] == "REVERSED"


@pytest.mark.parametrize("evidence", ["payment", "failed_payment", "proof"])
def test_payment_or_proof_blocks_reversal(api, db, empty_period, v22, evidence):
    claim_id, batch = exported(api, db, empty_period, v22)
    api.put("/provider-details/me", "chw1", {"mobile_money_number": "+255700000001"})
    if evidence == "proof":
        api.call("POST", f"/claims/{claim_id}/proofs", "fhifin1",
                 files={"file": ("proof.pdf", b"%PDF-1.4 test", "application/pdf")})
    else:
        api.post(f"/claims/{claim_id}/payments", "fhifin1", {
            "amount": 40000, "payment_reference": f"REVERSAL-{evidence}", "payment_date": empty_period["start_date"],
            "status": "FAILED" if evidence == "failed_payment" else "PAID",
        })
    url = f"/batches/{batch['id']}"
    assert api.get(url, "fhifin1")["can_reverse"] is False
    api.post(f"{url}/reverse", "fhifin1", REASON, expect=409)
    db.expire_all()
    assert db.get(PayrollBatch, batch["id"]).status == "EXPORTED"
    assert db.get(PaymentClaim, claim_id).batch_id == batch["id"]


def test_reversed_batch_stays_with_the_people_who_handled_it(api, db, empty_period, v22):
    claim_id, batch = exported(api, db, empty_period, v22)
    url = f"/batches/{batch['id']}"
    all_cadres(db, "fhifin2")
    assert api.get(url, "fhifin2")["status"] == "EXPORTED"
    api.post(f"{url}/reverse", "fhifin1", REASON)
    api.get(url, "fhifin2", expect=404)
    assert batch["id"] not in [row["id"] for row in api.get("/batches", "fhifin2")]
    assert api.get(url, "oversight1")["status"] == "REVERSED"
    assert api.get(url, "fhifin1")["status"] == "REVERSED"


def test_only_route_a_batches_can_be_reversed(api, db):
    batch = PayrollBatch(reference="B-REVERSAL-TEST", route_code="B", executor_org_id=1, status="EXPORTED",
                         created_by=1, export_snapshot={}, export_csv="")
    from backend.services.batches import reverse_block
    assert "Route A" in reverse_block(db, batch, [])
