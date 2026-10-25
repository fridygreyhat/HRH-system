from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ...core import audit as system_audit
from ...core.roles import TECHNICAL_OFFICER
from ...core.security import CurrentUser, require_roles
from ...core.settings import get_setting
from ...core.timeutil import local_today
from ...db.session import get_db
from ...models import BackdateAccess, Cadre, Region, Staff, StaffAssignment, User, utcnow
from ...services.scope import assignments_in_role_scope, assignment_in_role_scope

router = APIRouter()
technical = require_roles(TECHNICAL_OFFICER)


class AccessIn(BaseModel):
    staff_id: int
    entry_date: date
    valid_hours: int = Field(default=24, ge=1, le=168)
    reason: str = Field(min_length=5, max_length=1000)


def eligible_assignments(db, current, day):
    scoped = assignments_in_role_scope(current, TECHNICAL_OFFICER)
    query = db.query(StaffAssignment).join(Staff, Staff.id == StaffAssignment.staff_id).join(Cadre, Cadre.id == Staff.cadre_id).filter(
        Staff.status == "ACTIVE", Cadre.code.in_(["CHW", "HCP", "DATA_CLERK"]),
        StaffAssignment.start_date <= day,
        or_(StaffAssignment.end_date.is_(None), StaffAssignment.end_date >= day),
        Staff.user_id != current.id,
    )
    return query.filter(StaffAssignment.id.in_(scoped)) if scoped is not None else query.filter(False)


def output(db, row):
    staff = db.get(Staff, row.staff_id)
    actor = db.get(User, row.granted_by)
    return {"id": row.id, "staff_id": row.staff_id, "provider_name": staff.legal_name,
            "entry_date": str(row.entry_date), "expires_at": row.expires_at,
            "reason": row.reason, "granted_by_name": actor.full_name,
            "revoked_at": row.revoked_at,
            "status": "REVOKED" if row.revoked_at else "EXPIRED" if row.expires_at <= utcnow() else "ACTIVE"}


@router.get("")
def list_access(entry_date: date | None = None, db: Session = Depends(get_db), current: CurrentUser = Depends(technical)):
    day = entry_date or local_today()
    assignments = eligible_assignments(db, current, day).all()
    providers = {}
    for assignment in assignments:
        staff = db.get(Staff, assignment.staff_id)
        providers[staff.id] = {"id": staff.id, "name": staff.legal_name,
                               "cadre": db.get(Cadre, staff.cadre_id).name,
                               "region": db.get(Region, assignment.region_id).name}
    scoped = assignments_in_role_scope(current, TECHNICAL_OFFICER)
    grants = db.query(BackdateAccess).filter(BackdateAccess.entry_date == day)
    grants = grants.filter(BackdateAccess.assignment_id.in_(scoped)) if scoped is not None else grants.filter(False)
    grants = grants.filter(BackdateAccess.staff_id != current.staff_id)
    return {"grace_hours": get_setting(db, "backdate_grace_hours"),
            "providers": sorted(providers.values(), key=lambda p: p["name"]),
            "grants": [output(db, row) for row in grants.order_by(BackdateAccess.created_at.desc())]}


@router.post("", status_code=201)
def grant_access(body: AccessIn, db: Session = Depends(get_db), current: CurrentUser = Depends(technical)):
    if body.entry_date > local_today() or body.entry_date.weekday() == 6:
        raise HTTPException(422, "Choose a past work date; Sunday work is not allowed.")
    if len(body.reason.strip()) < 5:
        raise HTTPException(422, "Enter a meaningful reason for reopening the work date.")
    assignment = eligible_assignments(db, current, body.entry_date).filter(StaffAssignment.staff_id == body.staff_id).order_by(StaffAssignment.is_primary.desc(), StaffAssignment.start_date.desc()).first()
    if not assignment:
        raise HTTPException(403, "Provider is not in your technical area and cadre scope for this date.")
    # Same staff lock as entry editing prevents deadline checks racing revocation.
    db.query(Staff).filter(Staff.id == body.staff_id).with_for_update().one()
    row = BackdateAccess(staff_id=body.staff_id, assignment_id=assignment.id, entry_date=body.entry_date,
                         granted_by=current.id, reason=body.reason.strip(),
                         expires_at=utcnow() + timedelta(hours=body.valid_hours))
    db.add(row); db.flush()
    system_audit.record(db, current, "backdate_access", row.id, "grant",
                        after={"staff_id": row.staff_id, "entry_date": str(row.entry_date),
                               "expires_at": row.expires_at.isoformat(), "reason": row.reason})
    db.commit()
    return output(db, row)


@router.delete("/{access_id}")
def revoke_access(access_id: int, db: Session = Depends(get_db), current: CurrentUser = Depends(technical)):
    row = db.get(BackdateAccess, access_id)
    if not row:
        raise HTTPException(404, "Permission not found")
    staff = db.get(Staff, row.staff_id)
    if staff.user_id == current.id or not assignment_in_role_scope(db, current, TECHNICAL_OFFICER, row.assignment_id):
        raise HTTPException(403, "Permission is not in your technical scope")
    db.query(Staff).filter(Staff.id == row.staff_id).with_for_update().one()
    if row.revoked_at is None:
        row.revoked_at = utcnow()
        system_audit.record(db, current, "backdate_access", row.id, "revoke",
                            after={"staff_id": row.staff_id, "entry_date": str(row.entry_date)})
        db.commit()
    return output(db, row)
