"""Central Finance records a PRF for exactly the Services claims it downloaded, and never twice for the same claim."""
import csv
from datetime import timedelta
from io import StringIO

import pytest

from backend.core.period_dates import pay_month_of
from backend.core.timeutil import local_today
from backend.models import AuditEvent, ClaimCategory, PaymentClaim, PayPeriod, User, WorkLogEntry
from .test_approval_route_access import route  # noqa: F401
from .test_finance_monthly_reports import all_cadres
from .test_v22_finance import v22  # noqa: F401


@pytest.fixture
def claims(api, db, route):  # noqa: F811
    all_cadres(db, "fhifin1")
    admin = db.query(User).filter_by(username="admin").one()
    category = db.query(ClaimCategory.id).order_by(ClaimCategory.id).first()[0]
    made = []

    def claim(provider, amount=300):
        log = route["log"](provider, "SERVICES", "ROUTED_FHI360")
        day = db.get(PayPeriod, log.period_id).start_date
        db.add(WorkLogEntry(work_log_id=log.id, entry_date=day, hours_worked=6, evidence_text="PRF check", activity_key="prf_check",
                            activity_snapshot={"key": "prf_check", "label_en": "PRF check service"}))
        row = PaymentClaim(work_log_id=log.id, workflow_version=2, work_type="SERVICES", staff_id=log.staff_id, period_id=log.period_id,
                           assignment_id=log.assignment_id, category_id=category, route_code="A", amount=amount, currency="TZS", status="READY",
                           calculation_snapshot={"lines": [{"date": str(day), "activity_key": "prf_check", "activity": "PRF check service", "amount": str(amount)}]},
                           created_by=admin.id)
        db.add(row)
        db.commit()
        made.append(row)
        return row, pay_month_of(day)

    yield claim
    db.rollback()
    for row in made:
        db.get(PaymentClaim, row.id).status = "CANCELLED"
    db.commit()


def download(api, month, user="fhifin1", include_prf=False):
    response = api.client.get(f"/finance/services-payment-report/export?month={month}&format=csv{'&include_prf=true' if include_prf else ''}",
                              headers={"Authorization": f"Bearer {api.token(user)}"})
    return response


def claim_ids(response):
    return {row["Claim ID"] for row in csv.DictReader(StringIO(response.content.decode("utf-8-sig"))) if row["Claim ID"]}


def prf(api, download_id, number, expect=201, user="fhifin1", **extra):
    return api.post("/finance/services-payment-report/prf", user,
                    {"download_id": download_id, "prf_number": number, "prf_date": str(local_today()), **extra}, expect=expect)


def test_a_prf_covers_the_download_and_the_next_report_leaves_those_claims_out(api, db, claims):
    first, month = claims("chw1", 300)
    second, _ = claims("hcp1", 450)
    response = download(api, month)
    assert response.status_code == 200 and claim_ids(response) == {str(first.id), str(second.id)}
    download_id = int(response.headers["x-download-id"])
    summary = api.get(f"/finance/services-payment-report/downloads/{download_id}", "fhifin1")
    assert summary["claim_count"] == 2 and summary["amounts"] == {"TZS": "750"} and summary["prf"] is None

    recorded = prf(api, download_id, "PRF/2093/001", note="Signed by the director")
    assert recorded["claim_count"] == 2 and recorded["amounts"] == {"TZS": "750"}
    assert [row["prf_number"] for row in api.get(f"/finance/services-payment-report/prfs?month={month}", "fhifin1")] == ["PRF/2093/001"]
    assert db.query(AuditEvent).filter_by(action="record_prf", entity_id=str(recorded["id"])).count() == 1

    again = download(api, month)
    assert again.status_code == 404 and "already has a PRF" in again.json()["detail"]
    full = download(api, month, include_prf=True)
    rows = list(csv.DictReader(StringIO(full.content.decode("utf-8-sig"))))
    assert {row["PRF number"] for row in rows if row["Claim ID"]} == {"PRF/2093/001"}


def test_only_new_claims_go_on_the_next_prf(api, db, claims):
    first, month = claims("chw1")
    prf(api, int(download(api, month).headers["x-download-id"]), "PRF-A1")
    later, _ = claims("clerk1", 200)
    response = download(api, month)
    assert claim_ids(response) == {str(later.id)}
    assert prf(api, int(response.headers["x-download-id"]), "PRF-A2")["amounts"] == {"TZS": "200"}


def test_the_same_money_cannot_be_requested_twice(api, db, claims):
    _, month = claims("chw1")
    first = int(download(api, month).headers["x-download-id"])
    second = int(download(api, month).headers["x-download-id"])
    prf(api, first, "PRF-B1")
    prf(api, first, "PRF-B2", expect=409)
    prf(api, second, "PRF-B3", expect=409)
    included = int(download(api, month, include_prf=True).headers["x-download-id"])
    prf(api, included, "PRF-B4", expect=409)


def test_a_prf_number_is_used_once(api, db, claims):
    _, month = claims("chw1")
    prf(api, int(download(api, month).headers["x-download-id"]), "PRF-C1")
    claims("hcp1")
    prf(api, int(download(api, month).headers["x-download-id"]), "PRF-C1", expect=409)


def test_a_claim_cancelled_after_the_download_stops_the_prf(api, db, claims):
    claim, month = claims("chw1")
    download_id = int(download(api, month).headers["x-download-id"])
    db.get(PaymentClaim, claim.id).status = "CANCELLED"
    db.commit()
    prf(api, download_id, "PRF-D1", expect=409)


def test_claims_still_awaiting_central_review_cannot_go_on_a_prf(api, db, claims):
    claim, month = claims("chw1")
    db.get(PaymentClaim, claim.id).status = "PENDING_CENTRAL_REVIEW"
    db.commit()
    download_id = int(download(api, month).headers["x-download-id"])
    assert api.get(f"/finance/services-payment-report/downloads/{download_id}", "fhifin1")["awaiting_review"] == 1
    prf(api, download_id, "PRF-F1", expect=409)
    db.get(PaymentClaim, claim.id).status = "READY"
    db.commit()
    prf(api, int(download(api, month).headers["x-download-id"]), "PRF-F2")


def test_only_central_finance_records_their_own_download(api, db, claims, v22):  # noqa: F811
    _, month = claims("chw1")
    mine = int(download(api, month, user="admin").headers["x-download-id"])
    prf(api, mine, "PRF-E1", expect=404)
    api.post("/finance/services-payment-report/prf", v22["finance"],
             {"download_id": mine, "prf_number": "PRF-E2", "prf_date": str(local_today())}, expect=403)
    prf(api, mine, "PRF-E3", user="admin", prf_date=str(local_today() + timedelta(days=1)), expect=422)
    prf(api, mine, "=CMD()", user="admin", expect=422)
    prf(api, 999999, "PRF-E4", expect=404)


PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


def pay(api, prf_id, user="fhifin1", body=PNG, content_type="image/png", expect=201, **fields):
    data = {"payment_reference": "BANK-REF-1", "payment_date": str(local_today()), "beneficiaries_confirmed": "true", **fields}
    response = api.client.post(f"/finance/services-payment-report/prf/{prf_id}/proof", headers={"Authorization": f"Bearer {api.token(user)}"},
                               data=data, files={"file": ("schedule.png", body, content_type)})
    assert response.status_code == expect, response.text
    return response.json()


def recorded_prf(api, claims, number):
    first, month = claims("chw1", 300)
    second, _ = claims("hcp1", 450)
    return first, second, prf(api, int(download(api, month).headers["x-download-id"]), number)


def stored_files():
    from backend.core import config
    import os
    return set(os.listdir(config.UPLOAD_DIR)) if os.path.isdir(config.UPLOAD_DIR) else set()


def test_one_proof_pays_every_claim_on_the_prf_and_is_stored_once(api, db, claims):
    from backend.models import PaymentProof, PaymentRecord
    first, second, recorded = recorded_prf(api, claims, "PRF-P1")
    listed = api.get(f"/finance/services-payment-report/prf/{recorded['id']}/claims", "fhifin1")
    assert {row["claim_id"] for row in listed if row["can_record_with_proof"]} == {first.id, second.id}
    before = stored_files()
    pay(api, recorded["id"], payment_method="MOBILE_WALLET", expect=422)  # an HCP is paid by bank only: the whole upload is refused
    db.expire_all()
    assert {db.get(PaymentClaim, c.id).payment_status for c in (first, second)} == {"NOT_STARTED"} and stored_files() == before
    assert pay(api, recorded["id"], payment_method="BANK")["paid_count"] == 2
    db.expire_all()
    assert {db.get(PaymentClaim, c.id).payment_status for c in (first, second)} == {"PAID"}
    records = db.query(PaymentRecord).filter(PaymentRecord.claim_id.in_([first.id, second.id])).all()
    assert sorted(str(r.amount) for r in records) == ["300.00", "450.00"] and {r.payment_reference for r in records} == {"BANK-REF-1"}
    proofs = db.query(PaymentProof).filter(PaymentProof.claim_id.in_([first.id, second.id])).all()
    assert len(proofs) == 2 and len({p.storage_key for p in proofs}) == 1
    assert all(p.beneficiary_snapshot["prf_number"] == "PRF-P1" for p in proofs)
    assert len(stored_files() - before) == 1
    month = api.get(f"/finance/services-payment-report/prfs?month={recorded['month']}", "fhifin1")
    assert next(row for row in month if row["id"] == recorded["id"])["paid_count"] == 2
    pay(api, recorded["id"], expect=409)


def test_a_refused_proof_pays_nothing_and_leaves_no_file(api, db, claims):
    first, second, recorded = recorded_prf(api, claims, "PRF-P2")
    before = stored_files()
    pay(api, recorded["id"], beneficiaries_confirmed="false", expect=422)
    pay(api, recorded["id"], body=b"not an image", expect=415)
    pay(api, recorded["id"], payment_date=str(local_today() + timedelta(days=1)), expect=422)
    db.get(PaymentClaim, second.id).status = "PENDING_CENTRAL_REVIEW"
    db.commit()
    pay(api, recorded["id"], expect=409)
    db.expire_all()
    assert {db.get(PaymentClaim, c.id).payment_status for c in (first, second)} == {"NOT_STARTED"}
    assert stored_files() == before
    pay(api, recorded["id"], user="admin", expect=409)


def test_only_central_finance_uploads_prf_proof(api, db, claims, v22):  # noqa: F811
    _, _, recorded = recorded_prf(api, claims, "PRF-P3")
    pay(api, recorded["id"], user=v22["finance"], expect=403)
    pay(api, 999999, expect=404)


def test_a_claim_still_awaiting_finance_review_shows_its_trace(api, db, route):  # noqa: F811
    """Its category is chosen at finance review, so until then it has none."""
    log = route["log"]("chw1", "SERVICES", "PENDING_FINANCE_REVIEW")
    admin = db.query(User).filter_by(username="admin").one()
    claim = PaymentClaim(work_log_id=log.id, workflow_version=2, work_type="SERVICES", staff_id=log.staff_id, period_id=log.period_id,
                         assignment_id=log.assignment_id, amount=0, currency="TZS", status="PENDING_FINANCE_REVIEW", created_by=admin.id)
    db.add(claim)
    db.commit()
    try:
        assert api.get(f"/claims/{claim.id}/trace", "admin")["claim"]["category"] is None
    finally:
        claim.status = "CANCELLED"
        db.commit()
