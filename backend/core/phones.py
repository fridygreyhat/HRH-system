"""Tanzanian mobile numbers: the only numbers the SMS gateway can deliver to (reminders, codes, approvals)."""
import re

TZ_MOBILE = re.compile(r"^\+255[67]\d{8}$")
MESSAGE = "Phone: enter an active Tanzanian mobile number: 07XXXXXXXX, 06XXXXXXXX or +2557XXXXXXXX."


def tz_mobile(value) -> str:
    """Accept 07…, 06…, 2557… or +2557… (spaces and dashes allowed) and return +255…; refuse anything else."""
    raw = re.sub(r"[\s\-().]", "", str(value or ""))
    if re.fullmatch(r"0[67]\d{8}", raw):
        raw = "+255" + raw[1:]
    elif re.fullmatch(r"255[67]\d{8}", raw):
        raw = "+" + raw
    if not TZ_MOBILE.fullmatch(raw):
        raise ValueError(MESSAGE)
    return raw


def same_number(phone: str) -> list[str]:
    """Both ways a number may already be stored (older records keep 07…), for duplicate checks."""
    return [phone, "0" + phone[4:]] if TZ_MOBILE.fullmatch(phone) else [phone]
