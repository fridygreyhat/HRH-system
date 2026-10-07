"""Operational settings stored in the database so administrators can change approved policy without a deploy."""
from typing import Any

from sqlalchemy.orm import Session

from ..models import SystemSetting

DEFAULTS: dict[str, Any] = {
    "otp_length": 4,
    "otp_ttl_minutes": 10,
    "otp_max_attempts": 5,
    "otp_resend_cooldown_seconds": 60,
    "otp_max_sends_per_version": 5,
    # Approved events at which GPS may be sampled: "ENTRY" (daily check-in when saving a day) and/or "SUBMIT".
    "gps_capture_events": ["ENTRY", "SUBMIT"],
    "reminder_after_hours": 48,
    "reminder_repeat_hours": 48,
    "sms_max_attempts": 5,
    # Require uploaded proof before a CSO/FHI360 payment can be marked PAID.
    "payment_requires_proof": True,
    # Escalation beyond the base reviewer reminder is not defined by HRH yet; leave empty until approved.
    "escalation_recipient_roles": [],
}

SETTING_DESCRIPTIONS = {
    "otp_length": "Digits in the provider confirmation code",
    "otp_ttl_minutes": "Minutes before a confirmation code expires",
    "otp_max_attempts": "Wrong-code attempts allowed per code",
    "otp_resend_cooldown_seconds": "Minimum seconds between code sends",
    "otp_max_sends_per_version": "Maximum codes sent for one verified version",
    "gps_capture_events": "Events at which location is sampled: ENTRY and/or SUBMIT",
    "reminder_after_hours": "Hours pending before the first reviewer reminder",
    "reminder_repeat_hours": "Minimum hours between repeat reminders",
    "sms_max_attempts": "Delivery attempts before an SMS is marked failed",
    "payment_requires_proof": "Require proof upload before marking a payment PAID",
    "escalation_recipient_roles": "Roles to escalate overdue items to (empty = none)",
}


def get_setting(db: Session, key: str) -> Any:
    row = db.get(SystemSetting, key)
    return row.value if row else DEFAULTS[key]


def all_settings(db: Session) -> dict[str, Any]:
    stored = {s.key: s.value for s in db.query(SystemSetting).all()}
    return {k: stored.get(k, v) for k, v in DEFAULTS.items()}
