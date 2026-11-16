"""Bank details typed by people: plain names only, so they can never act as a spreadsheet formula or markup."""
import re
from typing import Optional

BANK_TEXT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 .,'&/()\-]{0,99}$")
MESSAGE = "Bank and branch names: letters, digits, spaces and . , ' & / ( ) - only, starting with a letter or digit."


def bank_text(value: Optional[str]) -> Optional[str]:
    value = re.sub(r"\s+", " ", value or "").strip()
    if not value:
        return None
    if not BANK_TEXT.fullmatch(value):
        raise ValueError(MESSAGE)
    return value
