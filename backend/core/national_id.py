"""A person's identity document: the National ID (NIDA) number or the Voter ID (Kadi ya Mpiga Kura) number.

NIDA numbers have 20 digits and are written 19900101-12345-12345-12 as on the card. Voter ID numbers differ between
card series, so they are kept as written (letters, digits and dashes), in capitals.
"""
import re
from typing import Optional

ID_TYPES = {"NIDA": "National ID (NIDA)", "VOTER": "Voter ID"}
NIDA_DIGITS = re.compile(r"^\d{20}$")
VOTER = re.compile(r"^[A-Z0-9][A-Z0-9-]{4,28}[A-Z0-9]$")
NIDA_MESSAGE = "National ID (NIDA): enter the 20-digit number, e.g. 19900101-12345-12345-12."
VOTER_MESSAGE = "Voter ID: enter the number as on the card, 6 to 30 letters and digits."


def id_type(value: Optional[str]) -> Optional[str]:
    """NIDA or VOTER; blank means not given. Spelled-out names ("National ID", "Voter ID") are accepted too."""
    text = (value or "").strip().upper()
    if not text:
        return None
    if text in ID_TYPES:
        return text
    if text.startswith(("NAT", "NIDA", "KITAMBULISHO")):
        return "NIDA"
    if text.startswith(("VOT", "MPIGA", "KADI")):
        return "VOTER"
    raise ValueError("ID type must be National ID (NIDA) or Voter ID.")


def id_number(kind: Optional[str], value: Optional[str]) -> Optional[str]:
    """The number in its standard form; blank means not given. Spaces are ignored."""
    text = re.sub(r"\s", "", str(value or "")).upper()
    if not text:
        return None
    if kind == "NIDA":
        digits = text.replace("-", "")
        if not NIDA_DIGITS.fullmatch(digits):
            raise ValueError(NIDA_MESSAGE)
        return f"{digits[:8]}-{digits[8:13]}-{digits[13:18]}-{digits[18:]}"
    if kind == "VOTER":
        if not VOTER.fullmatch(text):
            raise ValueError(VOTER_MESSAGE)
        return text
    raise ValueError("Choose the ID type (National ID or Voter ID) before the number.")


def identity(kind: Optional[str], number: Optional[str], required: bool) -> tuple[Optional[str], Optional[str]]:
    """Both or neither: a type with no number (or a number with no type) is an error, and so is neither when required."""
    kind = id_type(kind)
    number = id_number(kind, number) if (number or "").strip() else None
    if kind and not number:
        raise ValueError(f"Enter the {ID_TYPES[kind]} number.")
    if number is None and (required or kind):
        raise ValueError("Enter the person's National ID (NIDA) or Voter ID number.")
    return kind, number


def mask_id(value: Optional[str]) -> Optional[str]:
    """For people who may see the record but not the person's identity number: the last four characters only."""
    return f"•••{value[-4:]}" if value else value
