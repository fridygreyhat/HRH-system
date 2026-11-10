"""A date unlock only bypasses the new-entry deadline, never any other rule."""
from sqlalchemy import func

from ..models import BackdateAccess, utcnow
from ..core.settings import get_setting


def last_date(model=BackdateAccess):
    """The last date a grant covers: its end_date, or entry_date for a single day."""
    return func.coalesce(model.end_date, model.entry_date)


def covering(query, day):
    return query.filter(BackdateAccess.entry_date <= day, last_date() >= day)


def active_access(db, staff_id, entry_date, assignment_id=None):
    query = covering(db.query(BackdateAccess), entry_date).filter(
        BackdateAccess.staff_id == staff_id, BackdateAccess.revoked_at.is_(None), BackdateAccess.expires_at > utcnow(),
    )
    if assignment_id is not None:
        query = query.filter(BackdateAccess.assignment_id == assignment_id)
    return query.first()


def provider_access(db, staff_id):
    rows = db.query(BackdateAccess).filter(
        BackdateAccess.staff_id == staff_id, BackdateAccess.revoked_at.is_(None),
        BackdateAccess.expires_at > utcnow(),
    ).all()
    return {"enabled": get_setting(db, "backdate_restriction_enabled"),
            "grace_hours": get_setting(db, "backdate_grace_hours"),
            "grants": [{"entry_date": str(row.entry_date), "end_date": str(row.end_date or row.entry_date),
                        "expires_at": row.expires_at.isoformat()} for row in rows]}
