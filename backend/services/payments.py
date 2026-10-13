"""Recording payments executed outside the app (the MVP never initiates bank or wallet transfers).

Uploading proof never marks a claim PAID by itself: PAID needs a recorded payment action for the full amount
plus the required proof, then (if proof came later) an explicit confirmation. Reconciliation is done by a
different person from whoever recorded the payment.
"""
import hashlib
import os
import uuid
from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..core import audit as system_audit
from ..core import config
from ..core.roles import CSO_FINANCE, FHI360_FINANCE
from ..core.security import CurrentUser
from ..core.settings import get_setting
from ..models import PaymentClaim, PaymentProof, PaymentRecord, PayPeriod, PayrollBatch, Staff, User
from .staff_registry import check_payment_method
from . import budgets, notifications
from . import claims as cl
from .worklog_workflow import period_label

ALLOWED_PROOF_TYPES = {"application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg"}
# The file's first bytes must match its declared type (the browser's content type alone can be faked).
PROOF_SIGNATURES = {".pdf": b"%PDF-", ".png": b"\x89PNG\r\n\x1a\n", ".jpg": b"\xff\xd8\xff"}
RECONCILER_ROLE = {"A": FHI360_FINANCE, "B": FHI360_FINANCE, "C": CSO_FINANCE}


def executor_check(current: CurrentUser, claim: PaymentClaim) -> Optional[str]:
    role = cl.ROUTE_EXECUTOR_ROLE.get(claim.route_code or "")
    if not role or role not in current.roles:
        return f"Payments on Route {claim.route_code} are recorded by {role}"
    if role == CSO_FINANCE and not cl.user_in_executor_org(current, claim):
        return "This claim belongs to another CSO"
    return None


def payable_check(db: Session, claim: PaymentClaim) -> Optional[str]:
    if claim.payment_status in ("PAID", "RECONCILED"):
        return "This claim is already paid"
    if claim.route_code == "B":
        batch = db.get(PayrollBatch, claim.batch_id) if claim.batch_id else None
        if claim.status != cl.HANDED_OFF or not batch or batch.status != "RECEIVED":
            return "Route B payments are recorded after the CSO acknowledges receipt of the handed-off batch"
    elif claim.status != cl.EXPORTED:
        return "Payments are recorded only for exported claims"
    return None


def paid_total(db: Session, claim_id: int) -> Decimal:
    return db.query(func.coalesce(func.sum(PaymentRecord.amount), 0)).filter(
        PaymentRecord.claim_id == claim_id, PaymentRecord.status.in_(("PAID", "PARTIAL"))
    ).scalar()


def has_proof(db: Session, claim_id: int) -> bool:
    return db.query(PaymentProof).filter(PaymentProof.claim_id == claim_id).count() > 0


def payment_actions(db: Session, current: CurrentUser, claim: PaymentClaim) -> list[str]:
    actions = []
    can_execute = executor_check(current, claim) is None
    if can_execute and payable_check(db, claim) is None:
        if paid_total(db, claim.id) < claim.amount:
            actions.append("record_payment")
        actions.append("upload_proof")
    if can_execute and claim.payment_status == "PROOF_REQUIRED":
        actions.append("confirm_paid")
    if claim.payment_status == "PAID" and reconcile_check(db, current, claim) is None:
        actions.append("reconcile")
    return actions


def record_payment(db: Session, current: CurrentUser, claim: PaymentClaim, amount: Decimal, reference: str, payment_date: date, status: str, method: Optional[str]) -> PaymentRecord:
    reason = executor_check(current, claim) or payable_check(db, claim)
    if reason:
        raise HTTPException(status_code=403 if "recorded by" in reason or "another CSO" in reason else 409, detail=reason)
    if status not in ("PAID", "PARTIAL", "FAILED"):
        raise HTTPException(status_code=422, detail="status must be PAID, PARTIAL or FAILED")
    if method not in (None, "BANK", "MOBILE_WALLET"):
        raise HTTPException(status_code=422, detail="Payment method must be BANK or MOBILE_WALLET")
    staff = db.get(Staff, claim.staff_id) if claim.staff_id else None
    if staff:
        check_payment_method(db, staff.cadre_id, method)
    counted = status != "FAILED"
    already = paid_total(db, claim.id)
    if counted and already + amount > claim.amount:
        raise HTTPException(status_code=422, detail=f"Payment exceeds the outstanding balance of {claim.amount - already}")

    record = PaymentRecord(
        claim_id=claim.id,
        executor_org_id=claim.executor_org_id,
        payment_reference=reference,
        payment_method=method,
        amount=amount,
        payment_date=payment_date,
        status=status,
        recorded_by=current.id,
    )
    db.add(record)
    db.flush()
    if counted and claim.budget_line_id:
        budgets.spend(db, claim.budget_line_id, amount, claim.id, record.id, current.id)

    old_pay = claim.payment_status
    total = already + (amount if counted else 0)
    if total == 0:
        claim.payment_status = "FAILED" if status == "FAILED" else "PENDING"
    elif total < claim.amount:
        claim.payment_status = "PARTIALLY_RECORDED"
    elif get_setting(db, "payment_requires_proof") and not has_proof(db, claim.id):
        claim.payment_status = "PROOF_REQUIRED"
    else:
        claim.payment_status = "PAID"
    cl.audit(db, current, claim, "record_payment", cl.ROUTE_EXECUTOR_ROLE[claim.route_code], claim.status, old_pay,
             details={"reference": reference, "amount": str(amount), "status": status})
    if claim.payment_status == "PAID":
        _notify_paid(db, claim, reference)
    return record


def confirm_paid(db: Session, current: CurrentUser, claim: PaymentClaim) -> None:
    reason = executor_check(current, claim)
    if reason:
        raise HTTPException(status_code=403, detail=reason)
    if claim.payment_status != "PROOF_REQUIRED":
        raise HTTPException(status_code=409, detail="Only claims fully recorded and awaiting proof can be confirmed")
    if not has_proof(db, claim.id):
        raise HTTPException(status_code=422, detail="Upload proof of payment first")
    claim.payment_status = "PAID"
    cl.audit(db, current, claim, "confirm_paid", cl.ROUTE_EXECUTOR_ROLE[claim.route_code], claim.status, "PROOF_REQUIRED")
    last = db.query(PaymentRecord).filter(PaymentRecord.claim_id == claim.id).order_by(PaymentRecord.id.desc()).first()
    _notify_paid(db, claim, last.payment_reference if last else "")


def reconcile_check(db: Session, current: CurrentUser, claim: PaymentClaim) -> Optional[str]:
    role = RECONCILER_ROLE.get(claim.route_code or "")
    if not role or role not in current.roles:
        return f"Reconciliation on Route {claim.route_code} is done by {role}"
    if role == CSO_FINANCE and not cl.user_in_executor_org(current, claim):
        return "This claim belongs to another CSO"
    recorders = {r for (r,) in db.query(PaymentRecord.recorded_by).filter(PaymentRecord.claim_id == claim.id)}
    if current.id in recorders:
        return "Reconciliation must be done by someone other than the person who recorded the payment"
    return None


def reconcile(db: Session, current: CurrentUser, claim: PaymentClaim, comment: Optional[str]) -> None:
    if claim.payment_status != "PAID":
        raise HTTPException(status_code=409, detail="Only paid claims can be reconciled")
    reason = reconcile_check(db, current, claim)
    if reason:
        raise HTTPException(status_code=403, detail=reason)
    claim.payment_status = "RECONCILED"
    cl.audit(db, current, claim, "reconcile", RECONCILER_ROLE[claim.route_code], claim.status, "PAID", comment)


async def store_proof(db: Session, current: CurrentUser, claim: PaymentClaim, upload: UploadFile, payment_record_id: Optional[int]) -> PaymentProof:
    reason = executor_check(current, claim)
    if reason:
        raise HTTPException(status_code=403, detail=reason)
    if claim.status not in (cl.EXPORTED, cl.HANDED_OFF):
        raise HTTPException(status_code=409, detail="Proof can be attached only to exported or handed-off claims")
    extension = ALLOWED_PROOF_TYPES.get(upload.content_type or "")
    if not extension:
        raise HTTPException(status_code=415, detail="Proof must be a PDF, PNG or JPEG file")
    data = await upload.read(config.MAX_UPLOAD_BYTES + 1)
    if len(data) > config.MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File is larger than {config.MAX_UPLOAD_BYTES // (1024 * 1024)} MB")
    if not data:
        raise HTTPException(status_code=422, detail="The file is empty")
    if not data.startswith(PROOF_SIGNATURES[extension]):
        raise HTTPException(status_code=415, detail="The file content is not a valid PDF, PNG or JPEG")
    if payment_record_id and not db.query(PaymentRecord).filter(PaymentRecord.id == payment_record_id, PaymentRecord.claim_id == claim.id).count():
        raise HTTPException(status_code=404, detail="Payment record not found on this claim")

    key = f"{uuid.uuid4().hex}{extension}"
    os.makedirs(config.UPLOAD_DIR, exist_ok=True)
    with open(os.path.join(config.UPLOAD_DIR, key), "wb") as f:
        f.write(data)
    proof = PaymentProof(
        claim_id=claim.id,
        payment_record_id=payment_record_id,
        storage_key=key,
        original_filename=os.path.basename(upload.filename or "proof")[:255],
        content_type=upload.content_type,
        size_bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        uploaded_by=current.id,
    )
    db.add(proof)
    db.flush()
    cl.audit(db, current, claim, "upload_proof", cl.ROUTE_EXECUTOR_ROLE[claim.route_code], claim.status, claim.payment_status,
             details={"proof_id": proof.id, "sha256": proof.sha256, "filename": proof.original_filename})
    system_audit.record(db, current, "payment_proof", proof.id, "upload", after={"claim_id": claim.id, "sha256": proof.sha256})
    return proof


def proof_path(proof: PaymentProof) -> str:
    return os.path.join(config.UPLOAD_DIR, proof.storage_key)


def _notify_paid(db: Session, claim: PaymentClaim, reference: str) -> None:
    staff = db.get(Staff, claim.staff_id)
    user = db.get(User, staff.user_id) if staff.user_id else None
    notifications.enqueue(
        db,
        "PAYMENT_RECORDED",
        user,
        staff.verified_phone,
        related=("claim_payment", claim.id, "PAID"),
        period=period_label(db.get(PayPeriod, claim.period_id)),
        reference=reference,
    )
