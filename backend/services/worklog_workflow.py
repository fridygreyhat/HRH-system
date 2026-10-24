"""Work-log approval pipeline — identical order for every cadre:

DRAFT → PENDING_CTC_VERIFICATION (CTC In-Charge/Supervisor verifies; version frozen; OTP sent)
      → PENDING_PROVIDER_OTP_CONFIRMATION (provider confirms the frozen version)
      → PENDING_TECHNICAL_REVIEW (Cluster/Regional Technical Officer endorses)
      → PENDING_RPM_AUTHORIZATION (RPM authorizes) → APPROVED

Returns to the provider make the log editable again; resubmission restarts the whole chain, so every
downstream decision is re-made on the corrected data. Reviewers may also return to the previous stage.
"""
from typing import Optional

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..core.roles import FACILITY_IN_CHARGE, PROVIDER, RPM, SUPERVISOR, TECHNICAL_OFFICER
from ..core.security import CurrentUser
from ..core.settings import get_setting
from ..models import (
    Cadre,
    PaymentClaim,
    PayPeriod,
    Staff,
    StaffAssignment,
    User,
    WorkLog,
    WorkLogAudit,
    WorkLogEndorsement,
    WorkLogEntry,
    WorkLogVersion,
    utcnow,
)
from . import notifications
from .forms import build_snapshot, entries_with_measures, review_summary
from .activities import activity_for
from .scope import assignment_in_role_scope, assignments_in_role_scope, users_in_scope_for

DRAFT = "DRAFT"
PENDING_CTC = "PENDING_CTC_VERIFICATION"
PENDING_OTP = "PENDING_PROVIDER_OTP_CONFIRMATION"
PENDING_TECH = "PENDING_TECHNICAL_REVIEW"
PENDING_RPM = "PENDING_RPM_AUTHORIZATION"
APPROVED = "APPROVED"
RETURNED = "RETURNED_TO_PROVIDER"
REJECTED = "REJECTED"
BUDGET_HOLD = "BUDGET_HOLD"
CANCELLED = "CANCELLED"

ALL_STATUSES = [DRAFT, PENDING_CTC, PENDING_OTP, PENDING_TECH, PENDING_RPM, APPROVED, RETURNED, REJECTED, BUDGET_HOLD, CANCELLED]
EDITABLE_STATUSES = {DRAFT, RETURNED}
# Stage owner for reminders and queue age reporting
STAGE_OWNER = {PENDING_CTC: SUPERVISOR, PENDING_TECH: TECHNICAL_OFFICER, PENDING_RPM: RPM}

# (current status, action) -> (next status, role that performs it)
TRANSITIONS: dict[tuple[str, str], tuple[str, str]] = {
    (DRAFT, "submit"): (PENDING_CTC, PROVIDER),
    (RETURNED, "submit"): (PENDING_CTC, PROVIDER),
    (DRAFT, "cancel"): (CANCELLED, PROVIDER),
    (RETURNED, "cancel"): (CANCELLED, PROVIDER),
    (PENDING_CTC, "verify"): (PENDING_OTP, SUPERVISOR),
    (PENDING_CTC, "return"): (RETURNED, SUPERVISOR),
    (PENDING_OTP, "confirm_otp"): (PENDING_TECH, PROVIDER),
    (PENDING_OTP, "decline"): (RETURNED, PROVIDER),
    (PENDING_TECH, "endorse"): (PENDING_RPM, TECHNICAL_OFFICER),
    (PENDING_TECH, "return"): (RETURNED, TECHNICAL_OFFICER),
    (PENDING_TECH, "return_to_reviewer"): (PENDING_CTC, TECHNICAL_OFFICER),
    (PENDING_TECH, "reject"): (REJECTED, TECHNICAL_OFFICER),
    (PENDING_RPM, "authorize"): (APPROVED, RPM),
    (PENDING_RPM, "hold"): (BUDGET_HOLD, RPM),
    (PENDING_RPM, "return"): (RETURNED, RPM),
    (PENDING_RPM, "return_to_reviewer"): (PENDING_TECH, RPM),
    (PENDING_RPM, "reject"): (REJECTED, RPM),
    (BUDGET_HOLD, "release"): (PENDING_RPM, RPM),
    (APPROVED, "reopen"): (RETURNED, RPM),
}
COMMENT_REQUIRED = {"return", "return_to_reviewer", "reject", "hold", "release", "reopen", "decline"}
INTERNAL_ACTIONS = {"confirm_otp"}  # has its own endpoint (needs a code)
FACILITY_ENDORSEMENT = "FACILITY_IN_CHARGE"
FACILITY_ENDORSE_STATUSES = {PENDING_OTP, PENDING_TECH}


def _owns(current: CurrentUser, log: WorkLog) -> bool:
    return current.staff_id == log.staff_id


def check_action(db: Session, current: CurrentUser, log: WorkLog, action: str) -> Optional[str]:
    """None when allowed, otherwise the reason it is not."""
    if action == "facility_endorse":
        return _check_facility_endorse(db, current, log)
    transition = TRANSITIONS.get((log.status, action))
    if not transition:
        return f"Cannot '{action}' a work log in status {log.status}"
    role = transition[1]
    if role not in current.roles:
        return f"Requires the {role} role"
    if role == PROVIDER:
        return None if _owns(current, log) else "Only the provider who owns this work log can do this"
    if _owns(current, log):
        return "You cannot review your own work log"
    if not assignment_in_role_scope(db, current, role, log.assignment_id):
        return "This work log is outside your assigned scope"
    if action == "endorse" and db.get(Cadre, log.cadre_id).requires_facility_endorsement and not _has_facility_endorsement(db, log):
        return "The Facility In-Charge endorsement required by this cadre's form has not been recorded"
    if action == "reopen" and db.query(PaymentClaim).filter(PaymentClaim.work_log_id == log.id, PaymentClaim.status != "CANCELLED").count():
        return "Cancel the claims linked to this work log before reopening it"
    return None


def _has_facility_endorsement(db: Session, log: WorkLog) -> bool:
    return (
        db.query(WorkLogEndorsement)
        .filter(WorkLogEndorsement.work_log_id == log.id, WorkLogEndorsement.version == log.version, WorkLogEndorsement.kind == FACILITY_ENDORSEMENT)
        .count()
        > 0
    )


def _check_facility_endorse(db: Session, current: CurrentUser, log: WorkLog) -> Optional[str]:
    if FACILITY_IN_CHARGE not in current.roles:
        return f"Requires the {FACILITY_IN_CHARGE} role"
    if log.status not in FACILITY_ENDORSE_STATUSES:
        return "Facility endorsement is recorded after CTC verification and before technical endorsement"
    if _owns(current, log):
        return "You cannot endorse your own work log"
    if not assignment_in_role_scope(db, current, FACILITY_IN_CHARGE, log.assignment_id):
        return "This work log is outside your assigned scope"
    if _has_facility_endorsement(db, log):
        return "Already endorsed for this version"
    return None


def available_actions(db: Session, current: CurrentUser, log: WorkLog) -> list[str]:
    actions = [a for (s, a) in TRANSITIONS if s == log.status and a not in INTERNAL_ACTIONS and check_action(db, current, log, a) is None]
    if check_action(db, current, log, "facility_endorse") is None:
        actions.append("facility_endorse")
    return actions


def queue_condition(current: CurrentUser):
    """SQL condition for logs waiting on one of the user's reviewer roles, within that role's scope."""
    conditions = []
    for (status, action), (_, role) in TRANSITIONS.items():
        if role == PROVIDER or role not in current.roles or action in ("reopen",):
            continue
        scope = assignments_in_role_scope(current, role)
        if scope is not None:
            conditions.append((WorkLog.status == status) & WorkLog.assignment_id.in_(scope))
    if FACILITY_IN_CHARGE in current.roles:
        scope = assignments_in_role_scope(current, FACILITY_IN_CHARGE)
        if scope is not None:
            conditions.append(WorkLog.status.in_(FACILITY_ENDORSE_STATUSES) & WorkLog.assignment_id.in_(scope))
    if not conditions:
        return None
    return or_(*conditions) & (WorkLog.staff_id != current.staff_id)


def audit(db: Session, current: Optional[CurrentUser], log: WorkLog, action: str, role: Optional[str], old: Optional[str], comment=None, details=None) -> None:
    db.add(
        WorkLogAudit(
            work_log_id=log.id,
            version=log.version,
            actor_id=current.id if current else None,
            actor_role=role,
            action=action,
            old_status=old,
            new_status=log.status,
            comment=comment,
            details=jsonable_encoder(details) if details is not None else None,
        )
    )


def transition(
    db: Session,
    current: CurrentUser,
    log: WorkLog,
    action: str,
    comment: Optional[str] = None,
    details: Optional[dict] = None,
    expected_version: Optional[int] = None,
) -> WorkLog:
    if expected_version is not None and expected_version != log.version:
        raise HTTPException(status_code=409, detail="This work log changed since you opened it. Reload and review again.")
    reason = check_action(db, current, log, action)
    if reason:
        status = 409 if reason.startswith("Cannot") or "endorsement" in reason or "Cancel the claims" in reason else 403
        raise HTTPException(status_code=status, detail=reason)
    if action in COMMENT_REQUIRED and not (comment and comment.strip()):
        raise HTTPException(status_code=422, detail=f"A reason is required to '{action}'")
    if action == "submit":
        _validate_submission(db, log)

    old = log.status
    next_status, role = TRANSITIONS[(old, action)]
    now = utcnow()
    if action == "verify":
        log.version += 1
        log.confirmed_version = None
        db.add(WorkLogVersion(work_log_id=log.id, version=log.version, snapshot=build_snapshot(db, log), created_by=current.id))
        if not get_setting(db, "provider_otp_required"):
            # Provider confirmation is switched off: the CTC-verified version goes straight to technical review.
            next_status = PENDING_TECH
            log.confirmed_version = log.version
            details = {**(details or {}), "provider_confirmation": "not required"}
    if action == "confirm_otp":
        log.confirmed_version = log.version
    if action == "submit":
        log.submitted_at = now
    log.status = next_status
    log.status_changed_at = now
    log.approved_at = now if next_status == APPROVED else (None if next_status == RETURNED else log.approved_at)
    audit(db, current, log, action, role, old, comment, details)
    db.flush()
    _notify(db, log, action, comment)
    return log


def record_facility_endorsement(db: Session, current: CurrentUser, log: WorkLog, comment: Optional[str]) -> None:
    reason = _check_facility_endorse(db, current, log)
    if reason:
        raise HTTPException(status_code=403 if "role" in reason or "scope" in reason or "own" in reason else 409, detail=reason)
    db.add(WorkLogEndorsement(work_log_id=log.id, version=log.version, kind=FACILITY_ENDORSEMENT, actor_id=current.id, comment=comment))
    audit(db, current, log, "facility_endorse", FACILITY_IN_CHARGE, log.status, comment)


def _validate_submission(db: Session, log: WorkLog) -> None:
    if not db.query(WorkLogEntry).filter(WorkLogEntry.work_log_id == log.id).count():
        raise HTTPException(status_code=422, detail="Add at least one daily entry before submitting")
    if not log.attested_at:
        raise HTTPException(status_code=422, detail="Confirm the attestation before submitting")
    cadre = db.get(Cadre, log.cadre_id)
    for entry, measures in entries_with_measures(db, log.id):
        activity = activity_for(cadre.code, entry.activity_key)
        if not activity:
            raise HTTPException(status_code=422, detail=f"Select an activity for {entry.entry_date} before submitting.")
        missing = set(activity["required_fields"]) - set(measures)
        if missing:
            raise HTTPException(status_code=422, detail=f"Complete all required indicators for {entry.entry_date}: {', '.join(sorted(missing))}. Enter zero when none were recorded.")
    hour_flags = [flag for flag in review_summary(db, log)["anomalies"] if flag["code"] in {"DAILY_HOURS", "WEEKLY_HOURS"}]
    if hour_flags:
        raise HTTPException(status_code=422, detail=hour_flags[0]["message"])


def period_label(period: Optional[PayPeriod]) -> str:
    if not period:
        return ""
    return period.period_label or f"{period.start_date} to {period.end_date}"


def _notify(db: Session, log: WorkLog, action: str, comment: Optional[str]) -> None:
    staff = db.get(Staff, log.staff_id)
    provider_user = db.get(User, staff.user_id) if staff.user_id else None
    assignment = db.get(StaffAssignment, log.assignment_id)
    period = period_label(db.get(PayPeriod, log.period_id))
    related = ("work_log", log.id, log.status)
    ctx = {"provider": staff.legal_name, "period": period, "comment": comment or ""}

    def to_role(role: str, event: str) -> None:
        for user in users_in_scope_for(db, role, assignment):
            notifications.enqueue(db, event, user, None, related=related, **ctx)

    def to_provider(event: str) -> None:
        notifications.enqueue(db, event, provider_user, staff.verified_phone, related=related, **ctx)

    if log.status == PENDING_CTC:
        to_role(SUPERVISOR, "WORKLOG_RETURNED_TO_REVIEWER" if action == "return_to_reviewer" else "WORKLOG_SUBMITTED")
    elif log.status == PENDING_TECH:
        to_role(TECHNICAL_OFFICER, "WORKLOG_RETURNED_TO_REVIEWER" if action == "return_to_reviewer" else "WORKLOG_CONFIRMED")
    elif log.status == PENDING_RPM and action == "endorse":
        to_role(RPM, "WORKLOG_ENDORSED")
    elif log.status == APPROVED:
        to_provider("WORKLOG_APPROVED")
    elif log.status == RETURNED and action != "decline":
        to_provider("WORKLOG_REOPENED" if action == "reopen" else "WORKLOG_RETURNED")
    elif log.status == REJECTED:
        to_provider("WORKLOG_REJECTED")
