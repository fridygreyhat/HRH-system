import re

_PLAIN_NUMBER = re.compile(r"^[+-]?\d[\d .,]*$")


def spreadsheet_safe(value):
    """A cell Excel or LibreOffice will not run as a formula, even after leading whitespace.

    Text starting with = + - @ gets a leading apostrophe, except plain numbers such as +255712345678 or -5.
    """
    if isinstance(value, str) and value.lstrip()[:1] in ("=", "+", "-", "@") and not _PLAIN_NUMBER.match(value):
        return "'" + value
    return value


def to_dict(obj, exclude: tuple[str, ...] = ()) -> dict:
    """Plain dict of an ORM row's columns (FastAPI can't serialize ORM instances directly)."""
    return {c.key: getattr(obj, c.key) for c in obj.__table__.columns if c.key not in exclude}


def mask_phone(phone: str | None) -> str | None:
    if not phone:
        return phone
    return f"{phone[:4]}•••{phone[-3:]}" if len(phone) > 7 else "•••"


def mask_account(account: str | None) -> str | None:
    """Bank or wallet account for logs: only the last four characters."""
    if not account:
        return account
    return f"•••{str(account)[-4:]}" if len(str(account)) > 4 else "•••"


def mask_payment_fields(values: dict) -> dict:
    """Copy of a change set safe to store in the audit log."""
    out = dict(values)
    # The audit log is permanent and read by administrators: account numbers, phones and TINs keep their last digits only.
    for key in ("payment_account", "bank_account_number"):
        if key in out:
            out[key] = mask_account(out[key])
    for key in ("verified_phone", "mobile_money_number"):
        if key in out:
            out[key] = mask_phone(out[key])
    if out.get("tin_number"):
        out["tin_number"] = "***-***-" + str(out["tin_number"])[-3:]
    if out.get("id_number"):
        out["id_number"] = "•••" + str(out["id_number"])[-4:]
    return out
