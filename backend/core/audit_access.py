"""Audit history is administrative; operational review feedback is separate."""
from .roles import CENTRAL_ADMIN, SUPER_ADMIN, SYSTEM_ADMIN

AUDIT_ADMIN_ROLES = (CENTRAL_ADMIN, SUPER_ADMIN, SYSTEM_ADMIN)


def can_view_audit(current):
    return bool(set(AUDIT_ADMIN_ROLES).intersection(current.roles))
