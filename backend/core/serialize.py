import re


def to_dict(obj, exclude: tuple[str, ...] = ()) -> dict:
    """Plain dict of an ORM row's columns (FastAPI can't serialize ORM instances directly)."""
    return {c.key: getattr(obj, c.key) for c in obj.__table__.columns if c.key not in exclude}


_PLAIN_NUMBER = re.compile(r"^[+-]?\d[\d .,]*$")


def spreadsheet_safe(value):
    """A cell value that Excel / LibreOffice will not run as a formula (CSV/formula injection).

    Text starting with = + - @ tab or CR gets a leading apostrophe, except plain numbers such as +255712345678 or -5.
    """
    if isinstance(value, str) and value and value[0] in "=+-@\t\r" and not _PLAIN_NUMBER.match(value):
        return "'" + value
    return value


def mask_account(account: str | None) -> str | None:
    """Bank / wallet account for logs and lists: only the last four characters."""
    if not account:
        return account
    return f"•••{str(account)[-4:]}" if len(str(account)) > 4 else "•••"


def mask_payment_fields(values: dict) -> dict:
    """Copy of a change set safe to store in the audit log or show in a list."""
    out = dict(values)
    if "payment_account" in out:
        out["payment_account"] = mask_account(out["payment_account"])
    if "verified_phone" in out:
        out["verified_phone"] = mask_phone(out["verified_phone"])
    return out


def mask_phone(phone: str | None) -> str | None:
    if not phone:
        return phone
    return f"{phone[:4]}•••{phone[-3:]}" if len(phone) > 7 else "•••"
