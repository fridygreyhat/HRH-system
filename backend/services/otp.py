import hashlib
import hmac
import secrets
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..core import config
from ..core.settings import get_setting
from ..models import OTPChallenge, WorkLog, utcnow


# Development only (mock gateway + EXPOSE_DEV_OTP): last code per log, held in memory so the provider's
# screen can show it. Never persisted, never enabled in production.
_DEV_CODES: dict[int, str] = {}


def dev_code(work_log_id: int):
    return _DEV_CODES.get(work_log_id) if config.EXPOSE_DEV_OTP else None


def _hash(work_log_id: int, version: int, code: str) -> str:
    message = f"{work_log_id}:{version}:{code}".encode()
    return hmac.new(config.SECRET_KEY.encode(), message, hashlib.sha256).hexdigest()


def issue_otp(db: Session, log: WorkLog) -> str:
    """Create a code bound to the log's current frozen version; earlier codes are invalidated. Rate-limited."""
    sends = db.query(OTPChallenge).filter(OTPChallenge.work_log_id == log.id, OTPChallenge.version == log.version)
    if sends.count() >= get_setting(db, "otp_max_sends_per_version"):
        raise HTTPException(status_code=429, detail="Too many codes sent for this version. Contact your supervisor.")
    latest = sends.order_by(OTPChallenge.created_at.desc()).first()
    cooldown = get_setting(db, "otp_resend_cooldown_seconds")
    if latest and (utcnow() - latest.created_at).total_seconds() < cooldown:
        raise HTTPException(status_code=429, detail=f"Please wait {cooldown} seconds before requesting another code.")

    db.query(OTPChallenge).filter(OTPChallenge.work_log_id == log.id, OTPChallenge.is_used.is_(False)).update(
        {OTPChallenge.is_used: True}
    )
    length = int(get_setting(db, "otp_length"))
    code = f"{secrets.randbelow(10**length):0{length}d}"
    db.add(
        OTPChallenge(
            work_log_id=log.id,
            version=log.version,
            code_hash=_hash(log.id, log.version, code),
            expires_at=utcnow() + timedelta(minutes=get_setting(db, "otp_ttl_minutes")),
        )
    )
    db.flush()
    if config.EXPOSE_DEV_OTP:
        _DEV_CODES[log.id] = code
    return code


def verify_otp(db: Session, log: WorkLog, code: str) -> None:
    """Raises unless `code` matches the active challenge for the current version. Failed attempts are committed."""
    challenge = (
        db.query(OTPChallenge)
        .filter(OTPChallenge.work_log_id == log.id, OTPChallenge.is_used.is_(False), OTPChallenge.version == log.version)
        .order_by(OTPChallenge.created_at.desc())
        .with_for_update()
        .first()
    )
    if not challenge or challenge.expires_at < utcnow():
        raise HTTPException(status_code=400, detail="No active code. Request a new one.")
    max_attempts = get_setting(db, "otp_max_attempts")
    if challenge.attempts >= max_attempts:
        raise HTTPException(status_code=400, detail="Too many attempts. Request a new code.")

    challenge.attempts += 1
    if not hmac.compare_digest(challenge.code_hash, _hash(log.id, log.version, code.strip())):
        db.commit()
        remaining = max_attempts - challenge.attempts
        raise HTTPException(status_code=400, detail=f"Incorrect code. {remaining} attempt(s) left.")
    challenge.is_used = True
