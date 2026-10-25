"""Server-side data scoping. Every list and every action goes through these conditions.

A reviewer sees only work whose assignment falls inside the scopes granted for that role:
  SUPERVISOR          facility or community area
  FACILITY_IN_CHARGE  facility
  TECHNICAL_OFFICER   cluster (via facility.cluster_id) or region, and only the cadres in their technical area
  RPM                 region
  COMMUNITY_VERIFIER  community area
  CSO_FINANCE         organization (the CSO)
  REGIONAL_ADMIN      region
Reviewers with no matching scope see nothing. OVERSIGHT has read-only visibility everywhere.
"""
from datetime import date
from typing import Optional

from sqlalchemy import Integer, and_, case, cast, exists, false, or_, select, true
from sqlalchemy.orm import Session

from ..core.roles import (
    CENTRAL_ADMIN,
    COMMUNITY_VERIFIER,
    CSO_FINANCE,
    FACILITY_IN_CHARGE,
    FHI360_FINANCE,
    OVERSIGHT,
    REGIONAL_ADMIN,
    RPM,
    SUPERVISOR,
    SYSTEM_ADMIN,
    TECHNICAL_OFFICER,
    REGIONAL_FINANCE,
)
from ..core.security import CurrentUser
from ..models import (
    Facility,
    PaymentClaim,
    PayPeriod,
    Role,
    Staff,
    StaffAssignment,
    User,
    UserReviewCadre,
    UserRole,
    UserScope,
    WorkLog,
)

ROLE_SCOPE_DIMENSIONS: dict[str, tuple[str, ...]] = {
    SUPERVISOR: ("facility_id", "community_area_id"),
    FACILITY_IN_CHARGE: ("facility_id",),
    TECHNICAL_OFFICER: ("cluster_id", "region_id"),
    RPM: ("region_id",),
    COMMUNITY_VERIFIER: ("community_area_id",),
    CSO_FINANCE: ("organization_id",),
    REGIONAL_ADMIN: ("region_id",),
    REGIONAL_FINANCE: ("region_id",),
}


def _assignment_condition(current: CurrentUser, role: str):
    """Condition on StaffAssignment for assignments inside `role`'s scope, or None when the user has no scope."""
    if role not in current.roles:
        return None
    if current.unrestricted:
        return true()
    if role == TECHNICAL_OFFICER and not current.review_cadres:
        return None  # a technical officer with no technical area reviews nothing
    conditions = []
    for dim in ROLE_SCOPE_DIMENSIONS.get(role, ()):
        values = current.scope_values(dim)
        if not values:
            continue
        if dim == "cluster_id":
            conditions.append(StaffAssignment.facility_id.in_(select(Facility.id).where(Facility.cluster_id.in_(values))))
        else:
            conditions.append(getattr(StaffAssignment, dim).in_(values))
    if not conditions:
        return None
    if role == TECHNICAL_OFFICER:
        in_area = StaffAssignment.staff_id.in_(select(Staff.id).where(Staff.cadre_id.in_(current.review_cadres)))
        return and_(or_(*conditions), in_area)
    return or_(*conditions)


def assignments_in_role_scope(current: CurrentUser, role: str):
    condition = _assignment_condition(current, role)
    return None if condition is None else select(StaffAssignment.id).where(condition)


def assignment_in_role_scope(db: Session, current: CurrentUser, role: str, assignment_id: Optional[int]) -> bool:
    condition = _assignment_condition(current, role)
    if condition is None or assignment_id is None:
        return False
    return db.query(exists().where(StaffAssignment.id == assignment_id, condition)).scalar()


def worklog_visibility(current: CurrentUser):
    from .v22_scope import record_condition
    if current.has_any(OVERSIGHT, FHI360_FINANCE):
        if current.unrestricted or OVERSIGHT in current.roles:
            return true()
        # Legacy finance visibility is preserved, not extended to every new region/cadre.
        return or_(WorkLog.workflow_version == 1, record_condition(current, WorkLog.assignment_id, WorkLog.cadre_id))
    conditions = [WorkLog.staff_id == current.staff_id]
    for role in ROLE_SCOPE_DIMENSIONS:
        subquery = assignments_in_role_scope(current, role)
        if subquery is not None:
            condition = WorkLog.assignment_id.in_(subquery)
            if role == REGIONAL_FINANCE:
                condition = and_(condition, record_condition(current, WorkLog.assignment_id, WorkLog.cadre_id))
            elif role in (TECHNICAL_OFFICER, RPM, CSO_FINANCE):
                condition = and_(condition, or_(WorkLog.workflow_version == 1, record_condition(current, WorkLog.assignment_id, WorkLog.cadre_id, role=role)))
            conditions.append(condition)
    return or_(*conditions)


def claim_visibility(current: CurrentUser):
    from .v22_scope import record_condition
    if current.has_any(OVERSIGHT):
        return true()
    conditions = [PaymentClaim.staff_id == current.staff_id]
    direct_community = and_(PaymentClaim.workflow_version >= 2, PaymentClaim.work_type == "COMMUNITY",
                            PaymentClaim.route_code == "C", PaymentClaim.work_log_id.is_(None))
    claim_cadre = case(
        (direct_community, cast(PaymentClaim.calculation_snapshot["cadre_id"].astext, Integer)),
        else_=select(WorkLog.cadre_id).where(WorkLog.id == PaymentClaim.work_log_id).scalar_subquery(),
    )
    if FHI360_FINANCE in current.roles:
        conditions.append(and_(PaymentClaim.workflow_version == 1, PaymentClaim.route_code.in_(("A", "B"))))
        conditions.append(and_(PaymentClaim.workflow_version >= 2, PaymentClaim.work_type == "SERVICES",
                               record_condition(current, PaymentClaim.assignment_id, claim_cadre)))
        conditions.append(and_(PaymentClaim.route_code.is_(None), PaymentClaim.created_by == current.id))
    if CSO_FINANCE in current.roles:
        orgs = current.scope_values("organization_id")
        if orgs:
            conditions.append(
                and_(
                    PaymentClaim.executor_org_id.in_(orgs),
                    or_(and_(PaymentClaim.workflow_version == 1, or_(PaymentClaim.route_code == "C", PaymentClaim.status == "HANDED_OFF")),
                        and_(PaymentClaim.workflow_version >= 2,
                             or_(PaymentClaim.work_type == "PAYROLL",
                                 and_(direct_community, PaymentClaim.status.notin_(("DRAFT", "VALIDATION_NEEDED", "PENDING_COMMUNITY_VERIFICATION")))),
                             record_condition(current, PaymentClaim.assignment_id, claim_cadre))),
                )
            )
            conditions.append(and_(PaymentClaim.route_code.is_(None), PaymentClaim.created_by == current.id))
    for role in (RPM, COMMUNITY_VERIFIER, REGIONAL_FINANCE, TECHNICAL_OFFICER):
        subquery = assignments_in_role_scope(current, role)
        if subquery is not None:
            condition = PaymentClaim.assignment_id.in_(subquery)
            if role == COMMUNITY_VERIFIER:
                condition = and_(condition, PaymentClaim.route_code == "C",
                                 or_(PaymentClaim.workflow_version == 1, PaymentClaim.status.notin_(("DRAFT", "VALIDATION_NEEDED"))))
            if role == TECHNICAL_OFFICER:
                condition = and_(condition, direct_community, PaymentClaim.status.notin_(("DRAFT", "VALIDATION_NEEDED")),
                                 record_condition(current, PaymentClaim.assignment_id, claim_cadre))
            if role in (RPM, REGIONAL_FINANCE):
                scoped = record_condition(current, PaymentClaim.assignment_id, claim_cadre, role=role)
                condition = and_(condition, scoped if role == REGIONAL_FINANCE else or_(PaymentClaim.workflow_version == 1, scoped))
            conditions.append(condition)
    return or_(*conditions)


def can_see_gps(db: Session, current: CurrentUser, staff_id: int, assignment_id: Optional[int]) -> bool:
    """GPS coordinates: the staff member and the CTC/technical reviewers responsible for them only."""
    if current.staff_id == staff_id:
        return True
    return any(assignment_in_role_scope(db, current, role, assignment_id) for role in (SUPERVISOR, TECHNICAL_OFFICER))


def staff_visibility(current: CurrentUser):
    if current.has_any(CENTRAL_ADMIN, SYSTEM_ADMIN, OVERSIGHT, FHI360_FINANCE):
        return true()
    conditions = [Staff.id == current.staff_id]
    for role in ROLE_SCOPE_DIMENSIONS:
        subquery = assignments_in_role_scope(current, role)
        if subquery is not None:
            condition = Staff.id.in_(select(StaffAssignment.staff_id).where(StaffAssignment.id.in_(subquery)))
            if role == REGIONAL_FINANCE and not current.unrestricted:
                condition = and_(condition, Staff.cadre_id.in_(current.review_cadres))
            conditions.append(condition)
    return or_(*conditions) if conditions else false()


def assignment_for_period(db: Session, staff_id: int, period: PayPeriod) -> Optional[StaffAssignment]:
    assignment = _overlapping(db, staff_id, period.start_date, period.end_date)
    if assignment and period.region_id is not None and assignment.region_id != period.region_id:
        return None
    return assignment


def current_assignment(db: Session, staff_id: int, on: date) -> Optional[StaffAssignment]:
    return _overlapping(db, staff_id, on, on)


def _overlapping(db: Session, staff_id: int, start: date, end: date) -> Optional[StaffAssignment]:
    return (
        db.query(StaffAssignment)
        .filter(
            StaffAssignment.staff_id == staff_id,
            StaffAssignment.start_date <= end,
            or_(StaffAssignment.end_date.is_(None), StaffAssignment.end_date >= start),
        )
        .order_by(StaffAssignment.is_primary.desc(), StaffAssignment.start_date.desc())
        .first()
    )


def users_in_scope_for(db: Session, role: str, assignment: StaffAssignment, cadre_id=None, strict_cadre=False) -> list[User]:
    """Active users holding `role` whose scope covers `assignment` (used to address notifications)."""
    dims = ROLE_SCOPE_DIMENSIONS.get(role, ())
    matches = []
    if "facility_id" in dims and assignment.facility_id:
        matches.append(UserScope.facility_id == assignment.facility_id)
    if "community_area_id" in dims and assignment.community_area_id:
        matches.append(UserScope.community_area_id == assignment.community_area_id)
    if "region_id" in dims and assignment.region_id:
        matches.append(UserScope.region_id == assignment.region_id)
    if "organization_id" in dims and assignment.organization_id:
        matches.append(UserScope.organization_id == assignment.organization_id)
    if "cluster_id" in dims and assignment.facility_id:
        facility = db.get(Facility, assignment.facility_id)
        if facility and facility.cluster_id:
            matches.append(UserScope.cluster_id == facility.cluster_id)
    if not matches:
        return []
    query = (
        db.query(User)
        .join(UserRole, UserRole.user_id == User.id)
        .join(Role, Role.id == UserRole.role_id)
        .join(UserScope, UserScope.user_id == User.id)
        .filter(Role.name == role, User.is_active.is_(True), or_(*matches))
    )
    if role == TECHNICAL_OFFICER or (strict_cadre and role != RPM):
        cadre_id = cadre_id or db.get(Staff, assignment.staff_id).cadre_id
        query = query.join(UserReviewCadre, UserReviewCadre.user_id == User.id).filter(UserReviewCadre.cadre_id == cadre_id)
    return query.distinct().all()
