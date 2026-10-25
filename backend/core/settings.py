"""Operational settings stored in the database so administrators can change approved policy without a deploy."""
from typing import Any

from sqlalchemy.orm import Session

from ..models import SystemSetting

DEFAULTS: dict[str, Any] = {
    # Off only while no SMS gateway can deliver codes: CTC verification then goes straight to technical review.
    "provider_otp_required": True,
    "otp_length": 4,
    "otp_ttl_minutes": 10,
    "otp_max_attempts": 5,
    "otp_resend_cooldown_seconds": 60,
    "otp_max_sends_per_version": 5,
    # Approved events at which GPS may be sampled: "ENTRY" (daily check-in when saving a day) and/or "SUBMIT".
    "gps_capture_events": ["ENTRY", "SUBMIT"],
    # Refuse a submission that arrives without a location fix (the location is still never auto-rejected).
    "gps_required_on_submit": False,
    "reminder_after_hours": 24,
    "reminder_repeat_hours": 24,
    "max_daily_hours": 9.0,
    "max_weekly_hours": 45.0,
    "saturday_min_hours": 4.0,
    "saturday_max_hours": 6.0,
    "backdate_grace_hours": 48,
    "sms_max_attempts": 5,
    # Require uploaded proof before a CSO/FHI360 payment can be marked PAID.
    "payment_requires_proof": True,
    # Escalation beyond the base reviewer reminder is not defined by HRH yet; leave empty until approved.
    "escalation_recipient_roles": [],
    # Cadres (by code) whose salary may only be paid into a bank account, never a mobile wallet.
    "bank_only_cadres": ["HCP"],
    "login_max_failures": 5,
    "login_lockout_minutes": 15,
}

SETTING_DESCRIPTIONS = {
    "provider_otp_required": "Provider confirms the verified log with an SMS code (off: CTC verification goes straight to technical review)",
    "otp_length": "Digits in the provider confirmation code",
    "otp_ttl_minutes": "Minutes before a confirmation code expires",
    "otp_max_attempts": "Wrong-code attempts allowed per code",
    "otp_resend_cooldown_seconds": "Minimum seconds between code sends",
    "otp_max_sends_per_version": "Maximum codes sent for one verified version",
    "gps_required_on_submit": "A work log can be submitted only with a GPS location",
    "gps_capture_events": "Events at which location is sampled: ENTRY and/or SUBMIT",
    "reminder_after_hours": "Hours pending before the first reviewer reminder",
    "reminder_repeat_hours": "Minimum hours between repeat reminders",
    "max_daily_hours": "Maximum hours allowed per weekday (Monday–Friday)",
    "max_weekly_hours": "Maximum combined Monday–Friday hours; Saturday clinics are counted separately",
    "saturday_min_hours": "Minimum total hours for a Saturday weekend clinic",
    "saturday_max_hours": "Maximum total hours for a Saturday weekend clinic; Sunday work is not allowed",
    "backdate_grace_hours": "Maximum hours a provider may backdate a work-log entry",
    "sms_max_attempts": "Delivery attempts before an SMS is marked failed",
    "payment_requires_proof": "Require proof upload before marking a payment PAID",
    "escalation_recipient_roles": "Roles to escalate overdue items to (empty = none)",
    "bank_only_cadres": "Cadre codes (CHW, DATA_CLERK, HCP) that must be paid into a bank account",
    "login_max_failures": "Wrong passwords in a row before an account is locked",
    "login_lockout_minutes": "Minutes an account stays locked after too many wrong passwords",
}


def get_setting(db: Session, key: str) -> Any:
    row = db.get(SystemSetting, key)
    return row.value if row else DEFAULTS[key]


def all_settings(db: Session) -> dict[str, Any]:
    stored = {s.key: s.value for s in db.query(SystemSetting).all()}
    return {k: stored.get(k, v) for k, v in DEFAULTS.items()}
