"""Audit history is administrative; operational review feedback is separate."""
from .roles import CENTRAL_ADMIN, REGIONAL_FINANCE, SUPER_ADMIN, SYSTEM_ADMIN

AUDIT_ADMIN_ROLES = (CENTRAL_ADMIN, SUPER_ADMIN, SYSTEM_ADMIN)
# The approval steps a timesheet carries on paper: who submitted, verified, reviewed and approved it, and when.
SIGN_OFF_ACTIONS = ("submit", "verify", "confirm_otp", "facility_endorse", "endorse", "authorize")
SIGN_OFF_FIELDS = ("id", "work_log_id", "version", "action", "old_status", "new_status", "comment", "timestamp")
# Regional Finance approves the month from these papers, so it sees who signed each step (not the full audit trail).
SIGN_OFF_ROLES = (REGIONAL_FINANCE,)


def can_view_audit(current):
    return bool(set(AUDIT_ADMIN_ROLES).intersection(current.roles))


def can_view_sign_offs(current):
    return can_view_audit(current) or bool(set(SIGN_OFF_ROLES).intersection(current.roles))


def visible_audit(current, rows, to_dict):
    """Audit rows (row, actor name) as this user may see them: everything for administrators, the sign-off steps only
    for Regional Finance, nothing for anyone else."""
    if can_view_audit(current):
        return [{**to_dict(row), "actor_name": name} for row, name in rows]
    if can_view_sign_offs(current):
        return [{**{key: getattr(row, key) for key in SIGN_OFF_FIELDS}, "actor_name": name}
                for row, name in rows if row.action in SIGN_OFF_ACTIONS]
    return []
