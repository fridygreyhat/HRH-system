import logging
import re
import string
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models import SMSOutbox, SMSTemplate, User, utcnow
from .sms_gateway import get_sms_gateway
from .templates import EVENTS, LANGUAGES

logger = logging.getLogger(__name__)
MAX_COMMENT_CHARS = 120


def template_variables(text: str) -> set[str]:
    return {name for _, name, _, _ in string.Formatter().parse(text) if name}


def validate_template(event_name: str, text: str) -> None:
    if event_name not in EVENTS:
        raise HTTPException(status_code=404, detail=f"Unknown SMS event {event_name}")
    try:
        used = template_variables(text)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"Template syntax error: {e}")
    unknown = used - set(EVENTS[event_name]["variables"])
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown variables {sorted(unknown)}; allowed: {EVENTS[event_name]['variables']}")
    if len(text) > 320:
        raise HTTPException(status_code=422, detail="Keep SMS templates under 320 characters (2 SMS segments)")


def active_template(db: Session, event_name: str, language: str) -> tuple[Optional[SMSTemplate], str]:
    for lang in (language, "en"):
        row = (
            db.query(SMSTemplate)
            .filter(SMSTemplate.event_name == event_name, SMSTemplate.language == lang, SMSTemplate.is_active.is_(True))
            .first()
        )
        if row:
            return row, row.template_text
    return None, EVENTS[event_name].get(language if language in LANGUAGES else "en") or EVENTS[event_name]["en"]


def render(text: str, context: dict) -> str:
    safe = {k: _clean(v) for k, v in context.items()}
    return text.format_map(_Missing(safe))


def _clean(value) -> str:
    text = re.sub(r"\s+", " ", str(value if value is not None else "")).strip()
    return text if len(text) <= MAX_COMMENT_CHARS else text[: MAX_COMMENT_CHARS - 1] + "…"


class _Missing(dict):
    def __missing__(self, key):
        return ""


def enqueue(
    db: Session,
    event_name: str,
    user: Optional[User],
    phone: Optional[str],
    related: tuple[str, int, Optional[str]] | None = None,
    **context,
) -> Optional[SMSOutbox]:
    """Queue an SMS in the caller's transaction; the worker sends it only after commit."""
    phone = phone or (user.phone if user else None)
    if not phone:
        return None
    language = user.preferred_language if user else "sw"
    template, text = active_template(db, event_name, language)
    row = SMSOutbox(
        event_name=event_name,
        user_id=user.id if user else None,
        destination_phone=phone,
        language=template.language if template else language,
        template_id=template.id if template else None,
        message_body=render(text, context),
        status="PENDING",
        next_attempt_at=utcnow(),
        related_type=related[0] if related else None,
        related_id=related[1] if related else None,
        related_status=related[2] if related else None,
    )
    db.add(row)
    return row


def send_protected_now(db: Session, event_name: str, user: Optional[User], phone: str, secret_keys: tuple[str, ...], **context) -> SMSOutbox:
    """Send a transactional message (OTP) immediately. The stored copy has secrets masked; nothing is retried."""
    language = user.preferred_language if user else "sw"
    text = EVENTS[event_name].get(language) or EVENTS[event_name]["en"]
    body = render(text, context)
    message_id = get_sms_gateway().send_sms(phone, body, sensitive=True)
    row = SMSOutbox(
        event_name=event_name,
        user_id=user.id if user else None,
        destination_phone=phone,
        language=language,
        message_body=render(text, {**context, **{k: "••••" for k in secret_keys}}),
        status="SENT" if message_id else "FAILED",
        attempts=1,
        provider_message_id=message_id,
        last_error=None if message_id else "Gateway did not accept the message",
        sent_at=utcnow() if message_id else None,
    )
    db.add(row)
    return row
