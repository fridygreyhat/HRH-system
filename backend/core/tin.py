"""Tanzania Taxpayer Identification Number (TIN): nine digits, written 123-456-789 as on TRA certificates."""
import re
from typing import Optional

DIGITS = re.compile(r"^\d{9}$")
MESSAGE = "TIN: enter the 9-digit Taxpayer Identification Number, e.g. 123-456-789."


def tin_number(value: Optional[str]) -> Optional[str]:
    """Blank means not given. Spaces and dashes are ignored; the number is kept as 123-456-789."""
    if value is None:
        return None
    digits = re.sub(r"[\s\-]", "", str(value))
    if not digits:
        return None
    if not DIGITS.fullmatch(digits):
        raise ValueError(MESSAGE)
    return f"{digits[:3]}-{digits[3:6]}-{digits[6:]}"


def mask_tin(value: Optional[str]) -> Optional[str]:
    """For people who may see the record but not the person's tax details: the last three digits only."""
    return f"***-***-{value[-3:]}" if value else value
