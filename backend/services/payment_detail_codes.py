"""SMS codes that protect provider payment details.

An administrator can reset a provider's password, so a signed-in session does not prove the provider is asking.
The code goes to the registered phone, which only a second admin can change. There is deliberately no setting to
switch this off and the limits below are fixed: a single admin must not be able to weaken them. A provider who
cannot receive SMS asks for a payment correction, which needs a second admin.
"""
import hashlib
import hmac
import json
import secrets
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..core import audit as system_audit, config
from ..core.security import CurrentUser
from ..core.serialize import mask_phone
from ..core.settings import get_setting
from ..models import PaymentDetailsCode, Staff, User, utcnow
from . import notifications

CODE_LENGTH = 6
MAX_ATTEMPTS = 5
MAX_SENDS_PER_DAY = 5


def _hash(staff_id: int, details: dict, code: str) -> str:
    """The new details are part of the hash, so a code only ever approves the values it was sent for."""
    message = f"{staff_id}:{json.dumps(details, sort_keys=True)}:{code}".encode()
    return hmac.new(config.SECRET_KEY.encode(), message, hashlib.sha256).hexdigest()


def send(db: Session, current: CurrentUser, staff: Staff, details: dict) -> dict:
    """Commits: the code must exist before it leaves the building, and every send must count towards the limit."""
    sent = db.query(PaymentDetailsCode).filter(PaymentDetailsCode.staff_id == staff.id,
                                               PaymentDetailsCode.created_at > utcnow() - timedelta(days=1))
    if sent.count() >= MAX_SENDS_PER_DAY:
        raise HTTPException(429, "Too many codes were sent today. Try again tomorrow or contact your supervisor.")
    latest = sent.order_by(PaymentDetailsCode.created_at.desc()).first()
    cooldown = get_setting(db, "otp_resend_cooldown_seconds")
    if latest and (utcnow() - latest.created_at).total_seconds() < cooldown:
        raise HTTPException(429, f"Please wait {cooldown} seconds before requesting another code.")

    db.query(PaymentDetailsCode).filter(PaymentDetailsCode.staff_id == staff.id, PaymentDetailsCode.is_used.is_(False)).update(
        {PaymentDetailsCode.is_used: True})
    code = f"{secrets.randbelow(10 ** CODE_LENGTH):0{CODE_LENGTH}d}"
    minutes = get_setting(db, "otp_ttl_minutes")
    db.add(PaymentDetailsCode(staff_id=staff.id, code_hash=_hash(staff.id, details, code),
                              expires_at=utcnow() + timedelta(minutes=minutes)))
    system_audit.record(db, current, "staff", staff.id, "payment_details_code_sent")
    db.commit()
    outbox = notifications.send_protected_now(
        db, "PAYMENT_DETAILS_CODE", db.get(User, staff.user_id) if staff.user_id else None, staff.verified_phone,
        secret_keys=("code",), code=code, minutes=minutes)
    db.commit()
    if outbox.status != "SENT":
        raise HTTPException(502, "The SMS could not be sent, so nothing was changed. Try again later, or ask your "
                                 "administrator to request a payment correction.")
    return {"phone": mask_phone(staff.verified_phone), "minutes": minutes,
            **({"dev_otp": code} if config.EXPOSE_DEV_OTP else {})}


def verify(db: Session, current: CurrentUser, staff: Staff, details: dict, code: str | None) -> None:
    """Raises unless `code` was sent for exactly these details. Failed attempts are committed."""
    challenge = (db.query(PaymentDetailsCode)
                 .filter(PaymentDetailsCode.staff_id == staff.id, PaymentDetailsCode.is_used.is_(False))
                 .order_by(PaymentDetailsCode.created_at.desc()).with_for_update().first())
    if not code or challenge is None or challenge.expires_at < utcnow():
        raise HTTPException(400, "No active code. Request a new one.")
    if challenge.attempts >= MAX_ATTEMPTS:
        raise HTTPException(400, "Too many attempts. Request a new code.")
    challenge.attempts += 1
    if not hmac.compare_digest(challenge.code_hash, _hash(staff.id, details, code)):
        system_audit.record(db, current, "staff", staff.id, "payment_details_code_failed")
        db.commit()
        raise HTTPException(400, f"Incorrect code. {MAX_ATTEMPTS - challenge.attempts} attempt(s) left.")
    challenge.is_used = True
