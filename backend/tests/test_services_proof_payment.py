"""Matched Services proof/payment is atomic, scoped, and never records money twice."""
import json
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import HTTPException

from backend.core import config
from backend.models import FundingSource, PaymentClaim, PaymentProof, PaymentRecord
from backend.services import payments
from .test_services_without_budgets import empty_period
from .test_v22_finance import v22
from .test_fixed_daily_services import daily_rate, approve
from .test_finance_monthly_reports import all_cadres
from .test_ctc_facility_approval import no_provider_sms

pytestmark = pytest.mark.usefixtures("no_provider_sms")


def ready_claim(api, db, period, finance, provider):
    api.put("/provider-details/me", provider, {"mobile_money_number": "+255700123456"})
    activity = daily_rate(api, db, period, provider, 40000)
    log = api.post("/worklogs", provider, {"period_id": period["id"], "work_type": "SERVICES"})
    log = api.put(f"/worklogs/{log['id']}/entries/{period['start_date']}", provider, {
        "activity_key": activity["key"], "hours_worked": 2,
        "start_time": "08:00", "end_time": "10:00",
        "measures": {key: 3 for key in activity["fields"]},
    })
    log = approve(api, provider, log)
    source = db.query(FundingSource).filter_by(name="PnP").one()
    body = {"review_confirmed": True, "review_type": "SERVICES", "funding_source_id": source.id}
    log = api.post(f"/worklogs/{log['id']}/actions/finance_review", finance, body)
    routed = api.post("/finance/channel", finance, {
        **body, "work_log_id": log["id"],
        "target_payor_id": log["finance_snapshot"]["payor_org_id"],
        "expected_review_token": log["finance_snapshot"]["review_token"],
    })
    return api.get(f"/claims/{routed['claim_id']}", "fhifin1")


def upload(api, entries, period, *, user="fhifin1", confirmed=True, content_type="application/pdf"):
    return api.client.post("/claims/services/proof-payment",
        headers={"Authorization": f"Bearer {api.token(user)}"},
        data={"beneficiaries": json.dumps(entries), "payment_reference": "SYNTHETIC-BATCH-NOT-A-TRANSFER",
              "payment_date": period["start_date"], "beneficiaries_confirmed": str(confirmed).lower(),
              "payment_method": "BANK"},
        files={"file": ("isolated-proof.pdf", BytesIO(b"%PDF-1.4\nSynthetic beneficiary schedule\n%%EOF"), content_type)})


def selection(claim):
    m = claim["payment_manifest"]
    return {"claim_id": claim["id"], "provider_name": m["provider_name"],
            "service_names": m["services"], "amount": m["amount"]}


def test_batch_validation_rollback_partial_and_existing_full_payments(api, db, empty_period, v22, monkeypatch):
    for user in (v22["finance"], "tofficer1", "rpm1", "fhifin1", "fhifin2"):
        all_cadres(db, user)
    claims = [ready_claim(api, db, empty_period, v22["finance"], provider)
              for provider in ("chw1", "hcp1", "clerk1")]
    ids = [c["id"] for c in claims]
    entries = [selection(c) for c in claims[:2]]
    eligible = api.get("/claims/services/proof-payment/eligible", "fhifin1")
    assert set(ids) <= {c["claim_id"] for c in eligible}
    assert upload(api, entries, empty_period, user="csofin1").status_code == 403
    assert upload(api, entries, empty_period, user="chw1").status_code == 403
    assert upload(api, entries, empty_period, confirmed=False).status_code == 422
    assert upload(api, entries, empty_period, content_type="text/plain").status_code == 415
    assert upload(api, entries + entries, empty_period).status_code == 422
    assert upload(api, [{**entries[0], "amount": "999"}], empty_period).status_code == 409
    assert upload(api, [{**entries[0], "provider_name": "Wrong beneficiary"}], empty_period).status_code == 409
    assert upload(api, [{**entries[0], "service_names": ["Wrong service"]}], empty_period).status_code == 409
    assert db.query(PaymentProof).filter(PaymentProof.claim_id.in_(ids)).count() == 0
    assert db.query(PaymentRecord).filter(PaymentRecord.claim_id.in_(ids)).count() == 0

    api.post(f"/claims/{ids[0]}/payments", "fhifin1", {
        "amount": 10000, "payment_reference": "SYNTHETIC-PRIOR-PARTIAL",
        "payment_date": empty_period["start_date"], "status": "PARTIAL", "payment_method": "BANK"})
    before_files = set(Path(config.UPLOAD_DIR).glob("*"))
    original = payments.record_payment
    calls = 0

    def fail_second(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise HTTPException(409, "Synthetic downstream error")
        return original(*args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(payments, "record_payment", fail_second)
        assert upload(api, entries, empty_period).status_code == 409
    db.expire_all()
    assert db.query(PaymentProof).filter(PaymentProof.claim_id.in_(ids)).count() == 0
    assert db.query(PaymentRecord).filter(PaymentRecord.claim_id.in_(ids)).count() == 1
    assert set(Path(config.UPLOAD_DIR).glob("*")) == before_files
    assert db.get(PaymentClaim, ids[0]).payment_status == "PARTIALLY_RECORDED"
    result = upload(api, entries, empty_period)
    assert result.status_code == 201, result.text
    assert result.json()["paid_claim_ids"] == sorted(ids[:2])
    for index, claim_id in enumerate(ids[:2]):
        paid = api.get(f"/claims/{claim_id}", "fhifin1")
        assert paid["payment_status"] == "PAID"
        proof = paid["proofs"][-1]["beneficiary_snapshot"]
        assert proof["provider_name"] == claims[index]["staff_name"]
        assert proof["claim_amount"] == "40000.00"
        assert proof["payment_amount"] == ("30000.00" if index == 0 else "40000.00")
    assert upload(api, entries, empty_period).status_code == 409
    assert db.query(PaymentRecord).filter(PaymentRecord.claim_id.in_(ids[:2])).count() == 3
    assert db.query(PaymentProof).filter(PaymentProof.claim_id.in_(ids[:2])).count() == 2

    # A previously recorded full payment receives proof without recording the money again.
    full = api.post(f"/claims/{ids[2]}/payments", "fhifin1", {
        "amount": 40000, "payment_reference": "SYNTHETIC-ALREADY-RECORDED",
        "payment_date": empty_period["start_date"], "payment_method": "BANK"})
    assert full["payment_status"] == "PROOF_REQUIRED"
    assert full["payment_manifest"]["outstanding_amount"] == "0.00"
    response = upload(api, [selection(full)], empty_period)
    assert response.status_code == 201, response.text
    paid = api.get(f"/claims/{ids[2]}", "fhifin1")
    assert paid["payment_status"] == "PAID"
    assert paid["proofs"][-1]["beneficiary_snapshot"]["payment_amount"] == "40000.00"
    assert paid["proofs"][-1]["beneficiary_snapshot"]["newly_recorded_amount"] == "0.00"
    assert db.query(PaymentRecord).filter_by(claim_id=ids[2]).count() == 1
