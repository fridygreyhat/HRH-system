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


async def record_with_proof(db: Session, current, upload: UploadFile, items_json: str,
                            payment_reference: str, payment_date, beneficiaries_confirmed: bool,
                            payment_method: str | None):
    if not current.has_any(FHI360_FINANCE):
        raise HTTPException(403, "Only FHI360 Finance can upload proof for centrally paid Services.")
    if not beneficiaries_confirmed:
        raise HTTPException(422, "Confirm that the proof lists every selected provider, service and the payment amount shown.")
    reference = (payment_reference or "").strip()
    if not 1 <= len(reference) <= 200:
        raise HTTPException(422, "Enter the payment reference printed on the proof.")
    if payment_method not in (None, "BANK", "MOBILE_WALLET"):
        raise HTTPException(422, "Payment method must be BANK or MOBILE_WALLET.")
    try:
        raw_items = json.loads(items_json)
    except (TypeError, ValueError):
        raise HTTPException(422, "Refresh the beneficiary list and try again.")
    if upload.content_type not in ALLOWED_PROOF_TYPES:
        raise HTTPException(415, "Proof must be a PDF, PNG or JPEG file.")
    rows = _parse_manifest(db, current, raw_items)
    created_paths = []
    result_claims = []
    try:
        for claim, expected in rows:
            await upload.seek(0)
            proof = await payments.store_proof(db, current, claim, upload, None)
            created_paths.append(payments.proof_path(proof))
            proof.beneficiary_snapshot = {
                "provider_id": expected["provider_id"], "provider_name": expected["provider_name"],
                "services": expected["services"], "claim_amount": expected["amount"],
                "payment_amount": expected["outstanding_amount"] if Decimal(expected["outstanding_amount"]) else expected["amount"],
                "newly_recorded_amount": expected["outstanding_amount"],
                "amount_before_payment": expected["amount_recorded"],
                "currency": expected["currency"], "payment_reference": reference,
                "payment_date": str(payment_date), "beneficiaries_confirmed": True,
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
        for path in created_paths:
            try:
                if os.path.isfile(path):
                    os.remove(path)
            except OSError:
                pass
        raise
    return result_claims
