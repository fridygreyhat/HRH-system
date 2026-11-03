"""Named, region/cadre-scoped Central Finance Services handoff.

Existing routed claims are not retroactively assigned or unapproved.
"""
from fastapi import HTTPException

from ..core.roles import FHI360_FINANCE
from ..core.security import load_current_user
from ..models import Role, StaffAssignment, User, UserRole, utcnow
from .v22_scope import may_manage

PENDING = "PENDING_CENTRAL_REVIEW"


def eligible_reviewers(db, log):
    assignment = db.get(StaffAssignment, log.assignment_id)
    if not assignment:
        return []
    users = (db.query(User).join(UserRole, UserRole.user_id == User.id)
             .join(Role, Role.id == UserRole.role_id)
             .filter(User.is_active.is_(True), Role.name == FHI360_FINANCE)
             .order_by(User.full_name, User.id).all())
    return [user for user in users
            if may_manage(load_current_user(db, user), assignment.region_id, log.cadre_id)]


def assign(db, current, log, claim, reviewer_id):
    if reviewer_id is None:
        raise HTTPException(422, "Select a named Central Finance reviewer for these Services.")
    user = db.query(User).filter_by(id=reviewer_id).with_for_update().first()
    if not user or user.id not in {row.id for row in eligible_reviewers(db, log)}:
        raise HTTPException(422, "The Central Finance reviewer must be active and authorized for this region and cadre.")
    if user.id == current.id:
        raise HTTPException(422, "Select a different person for Central Finance review.")
    claim.central_reviewer_id = user.id
    claim.central_reviewed_at = None
    claim.status = PENDING
    return user


def can_approve(current, claim):
    from .claims import channel_scope_ok
    return (claim.status == PENDING and claim.work_type == "SERVICES"
            and current.id == claim.central_reviewer_id
            and FHI360_FINANCE in current.roles
            and current.staff_id != claim.staff_id
            and current.user.is_active and channel_scope_ok(current, claim))


def approve(db, current, claim, confirmed, expected_amount, comment=None):
    from . import claims
    if not can_approve(current, claim):
        raise HTTPException(403, "Only the selected, authorized Central Finance reviewer may approve these Services.")
    if not confirmed:
        raise HTTPException(422, "Confirm that you reviewed the Services print preview before approving.")
    if expected_amount != claim.amount:
        raise HTTPException(409, "The Services amount changed. Refresh and review the current print preview.")
    old = claim.status
    claim.central_reviewed_at = utcnow()
    claim.status = claims.READY
    claims.audit(db, current, claim, "central_approve", FHI360_FINANCE, old,
                 claim.payment_status, comment,
                 details={"central_reviewer_id": current.id, "print_preview_confirmed": True})
