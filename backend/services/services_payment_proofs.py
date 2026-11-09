"""Upload a checked FHI360 Services beneficiary schedule and record matching disbursements."""
import json
import os
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..core.roles import FHI360_FINANCE
from ..core import audit
from ..models import PaymentClaim, PaymentRecord, Staff
from . import claims as cl, payments
from .payments import ALLOWED_PROOF_TYPES
from .scope import claim_visibility

MAX_BENEFICIARIES = 25


def manifest(db: Session, current, claim: PaymentClaim) -> dict | None:
    if (claim.workflow_version < 2 or claim.work_type != "SERVICES" or claim.route_code != "A"
            or cl.finance_role(claim) != FHI360_FINANCE
            or payments.executor_check(current, claim) is not None
            or payments.payable_check(db, claim) is not None
            or claim.payment_status in ("PAID", "RECONCILED")):
        return None
    lines = (claim.calculation_snapshot or {}).get("lines", [])
    services = sorted({str(line.get("activity", "")).strip() for line in lines
                       if isinstance(line, dict) and str(line.get("activity", "")).strip()})
    if not services:
        return None
    amount = Decimal(str(claim.amount)).quantize(Decimal("0.01"))
    recorded = payments.paid_total(db, claim.id).quantize(Decimal("0.01"))
    outstanding = amount - recorded
    if amount <= 0 or outstanding < 0 or (outstanding == 0 and claim.payment_status != "PROOF_REQUIRED"):
        return None
    staff = db.get(Staff, claim.staff_id)
    if not staff:
        return None
    return {"claim_id": claim.id, "provider_id": claim.staff_id, "provider_name": staff.legal_name,
        "services": services, "amount": str(amount), "amount_recorded": str(recorded),
        "outstanding_amount": str(outstanding), "currency": claim.currency,
        "can_record_with_proof": True}


def eligible_claims(db: Session, current):
    if not current.has_any(FHI360_FINANCE):
        raise HTTPException(403, "Only FHI360 Finance can select centrally paid Services.")
    claims = db.query(PaymentClaim).filter(
        claim_visibility(current), PaymentClaim.workflow_version >= 2,
        PaymentClaim.work_type == "SERVICES", PaymentClaim.route_code == "A",
        PaymentClaim.status.in_((cl.READY, cl.EXPORTED)),
        PaymentClaim.payment_status.in_(("NOT_STARTED", "PENDING", "PARTIALLY_RECORDED", "PROOF_REQUIRED", "FAILED")),
    ).order_by(PaymentClaim.period_id.desc(), PaymentClaim.staff_id).limit(200).all()
    return [value for claim in claims if (value := manifest(db, current, claim))]


def _parse_manifest(db, current, items):
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_BENEFICIARIES:
        raise HTTPException(422, "Select between 1 and 25 FHI360 Services claims.")
    result, seen, currencies, normalized = [], set(), set(), []
    for item in items:
        if not isinstance(item, dict) or set(item) != {"claim_id", "provider_name", "service_names", "amount"}:
            raise HTTPException(422, "The beneficiary list has invalid fields. Refresh and select the claims again.")
        try:
            if not isinstance(item["claim_id"], int) or isinstance(item["claim_id"], bool):
                raise ValueError()
            claim_id = item["claim_id"]
        except (TypeError, ValueError):
            raise HTTPException(422, "Each beneficiary must reference a valid claim.")
        if claim_id <= 0 or claim_id in seen:
            raise HTTPException(422, "Duplicate or invalid claim in beneficiary list.")
        seen.add(claim_id)
        normalized.append((claim_id, item))
    # Acquire row locks in stable order to avoid deadlocks on overlapping uploads.
    for claim_id, item in sorted(normalized):
        claim = db.query(PaymentClaim).filter(
            PaymentClaim.id == claim_id, claim_visibility(current)
        ).populate_existing().with_for_update().one_or_none()
        if claim is None:
            raise HTTPException(404, "A selected Services claim no longer exists.")
        reason = payments.executor_check(current, claim)
        if reason:
            raise HTTPException(403, reason)
        reason = payments.payable_check(db, claim)
        expected = manifest(db, current, claim)
        if reason or expected is None:
            raise HTTPException(409, "A selected Services claim is no longer eligible for proof payment.")
        try:
            amount = Decimal(str(item["amount"])).quantize(Decimal("0.01"))
        except (InvalidOperation, TypeError, ValueError):
            raise HTTPException(422, "The beneficiary amount is invalid.")
        services = item["service_names"]
        if not isinstance(services, list) or not all(isinstance(name, str) for name in services):
            raise HTTPException(422, "Service names must be a list of names.")
        if (item["provider_name"] != expected["provider_name"]
                or sorted(set(services)) != expected["services"] or amount != Decimal(expected["amount"])):
            raise HTTPException(409, f"Provider, service names or approved amount for claim {claim.id} changed. Refresh the list.")
        currencies.add(claim.currency)
        result.append((claim, expected))
    if len(currencies) > 1:
        raise HTTPException(422, "One payment-proof upload must use a single currency.")
    return result


def _record(db: Session, current, upload: UploadFile, rows, reference: str, payment_date, payment_method: str | None,
            extra: dict | None = None) -> list[int]:
    """Store the document once, then record each claim's outstanding payment against it, all in one transaction."""
    stored = payments.save_proof_file(upload)
    path = os.path.join(payments.config.UPLOAD_DIR, stored["storage_key"])
    result_claims = []
    try:
        for claim, expected in rows:
            proof = payments.attach_proof(db, current, claim, stored, None)
            proof.beneficiary_snapshot = {
                "provider_id": expected["provider_id"], "provider_name": expected["provider_name"],
                "services": expected["services"], "claim_amount": expected["amount"],
                "payment_amount": expected["outstanding_amount"] if Decimal(expected["outstanding_amount"]) else expected["amount"],
                "newly_recorded_amount": expected["outstanding_amount"],
                "amount_before_payment": expected["amount_recorded"],
                "currency": expected["currency"], "payment_reference": reference,
                "payment_date": str(payment_date), "beneficiaries_confirmed": True, **(extra or {}),
            }
            due = Decimal(expected["outstanding_amount"])
            already_recorded = Decimal(expected["amount_recorded"])
            if due > 0 and already_recorded < Decimal(expected["amount"]):
                payment = payments.record_payment(db, current, claim, due, reference, payment_date,
                                                  "PAID", payment_method)
                proof.payment_record_id = payment.id
            else:
                latest = db.query(PaymentRecord).filter(
                    PaymentRecord.claim_id == claim.id,
                    PaymentRecord.status.in_(("PAID", "PARTIAL"))).order_by(PaymentRecord.id.desc()).first()
                if latest:
                    proof.payment_record_id = latest.id
                # Proof arrived after the full amount was already recorded.
                if claim.payment_status == "PROOF_REQUIRED":
                    payments.confirm_paid(db, current, claim)
            audit.record(db, current, "payment_proof", proof.id, "match_services_payment",
                         after=proof.beneficiary_snapshot,
                         reason="Finance confirmed the uploaded document matches the listed beneficiary, Services and payment amount.")
            result_claims.append(claim.id)
        db.commit()
    except Exception:
        db.rollback()
        try:
            if os.path.isfile(path):
                os.remove(path)
        except OSError:
            pass
        raise
    return result_claims


def _check_payment_fields(current, beneficiaries_confirmed, payment_reference, payment_method, upload):
    if not current.has_any(FHI360_FINANCE):
        raise HTTPException(403, "Only FHI360 Finance can upload proof for centrally paid Services.")
    if not beneficiaries_confirmed:
        raise HTTPException(422, "Confirm that the proof lists every selected provider, service and the payment amount shown.")
    reference = (payment_reference or "").strip()
    if not 1 <= len(reference) <= 200:
        raise HTTPException(422, "Enter the payment reference printed on the proof.")
    if payment_method not in (None, "BANK", "MOBILE_WALLET"):
        raise HTTPException(422, "Payment method must be BANK or MOBILE_WALLET.")
    if upload.content_type not in ALLOWED_PROOF_TYPES:
        raise HTTPException(415, "Proof must be a PDF, PNG or JPEG file.")
    return reference


def record_with_proof(db: Session, current, upload: UploadFile, items_json: str,
                      payment_reference: str, payment_date, beneficiaries_confirmed: bool,
                      payment_method: str | None):
    reference = _check_payment_fields(current, beneficiaries_confirmed, payment_reference, payment_method, upload)
    try:
        raw_items = json.loads(items_json)
    except (TypeError, ValueError):
        raise HTTPException(422, "Refresh the beneficiary list and try again.")
    rows = _parse_manifest(db, current, raw_items)
    return _record(db, current, upload, rows, reference, payment_date, payment_method)


def prf_claims(db: Session, current, prf_id: int) -> list[PaymentClaim]:
    from ..models import PaymentRequestForm, PaymentRequestFormClaim
    if db.get(PaymentRequestForm, prf_id) is None:
        raise HTTPException(404, "PRF not found.")
    ids = [claim_id for (claim_id,) in db.query(PaymentRequestFormClaim.claim_id).filter_by(prf_id=prf_id).order_by(PaymentRequestFormClaim.claim_id)]
    claims = db.query(PaymentClaim).filter(PaymentClaim.id.in_(ids or [-1]), claim_visibility(current)).order_by(PaymentClaim.id).all()
    if len(claims) != len(ids):
        raise HTTPException(404, "PRF not found.")  # part of it is outside this user's finance scope
    return claims


def prf_beneficiaries(db: Session, current, prf_id: int) -> list[dict]:
    """Every claim on the PRF: what a proof for it would pay now, or that it is already paid."""
    result = []
    for claim in prf_claims(db, current, prf_id):
        row = manifest(db, current, claim)
        staff = db.get(Staff, claim.staff_id)
        result.append(row or {"claim_id": claim.id, "provider_id": claim.staff_id, "provider_name": staff.legal_name,
                              "services": [], "amount": str(claim.amount), "amount_recorded": str(payments.paid_total(db, claim.id)),
                              "outstanding_amount": "0.00", "currency": claim.currency, "can_record_with_proof": False})
        result[-1]["payment_status"] = claim.payment_status
    return result


def record_prf_proof(db: Session, current, prf_id: int, upload: UploadFile, payment_reference: str, payment_date,
                     beneficiaries_confirmed: bool, payment_method: str | None) -> list[int]:
    """One proof for a whole PRF: the PRF already fixed which claims and amounts are being paid."""
    from ..models import PaymentRequestForm
    reference = _check_payment_fields(current, beneficiaries_confirmed, payment_reference, payment_method, upload)
    prf = db.get(PaymentRequestForm, prf_id)
    rows, currencies = [], set()
    for claim in prf_claims(db, current, prf_id):  # stable id order, so overlapping uploads lock in the same order
        claim = db.query(PaymentClaim).filter_by(id=claim.id).populate_existing().with_for_update().one()
        if claim.payment_status in ("PAID", "RECONCILED"):
            continue
        reason = payments.executor_check(current, claim)
        if reason:
            raise HTTPException(403, reason)
        expected = manifest(db, current, claim)
        if expected is None or payments.payable_check(db, claim):
            raise HTTPException(409, f"Claim #{claim.id} on this PRF cannot take a payment now ({claim.status}, {claim.payment_status}).")
        currencies.add(claim.currency)
        rows.append((claim, expected))
    if not rows:
        raise HTTPException(409, f"Every claim on PRF {prf.prf_number} is already paid.")
    if len(currencies) > 1:
        raise HTTPException(422, "This PRF mixes currencies. Upload proof through Services proof + payment, one currency at a time.")
    paid = _record(db, current, upload, rows, reference, payment_date, payment_method, {"prf_number": prf.prf_number})
    audit.record(db, current, "payment_request_form", prf.id, "prf_proof_payment",
                 after={"prf_number": prf.prf_number, "claim_ids": paid, "payment_reference": reference, "payment_date": str(payment_date)})
    db.commit()
    return paid
