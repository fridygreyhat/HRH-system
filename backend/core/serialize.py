def to_dict(obj, exclude: tuple[str, ...] = ()) -> dict:
    """Plain dict of an ORM row's columns (FastAPI can't serialize ORM instances directly)."""
    return {c.key: getattr(obj, c.key) for c in obj.__table__.columns if c.key not in exclude}


def mask_phone(phone: str | None) -> str | None:
    if not phone:
        return phone
    return f"{phone[:4]}•••{phone[-3:]}" if len(phone) > 7 else "•••"
