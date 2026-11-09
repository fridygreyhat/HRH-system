"""Oversight dashboard. Every figure respects the caller's scope (a CSO sees only its own numbers)."""
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import DateTime, func, literal, or_
from sqlalchemy.orm import Session

from ...core.roles import CSO_FINANCE, CSO_TECHNICAL, FHI360_FINANCE, OVERSIGHT, RPM, TECHNICAL_OFFICER, SUPERVISOR, CENTRAL_ADMIN, REGIONAL_ADMIN, REGIONAL_FINANCE
from ...core.security import CurrentUser, require_roles
from ...core.settings import get_setting
from ...db.session import get_db
from ...models import BudgetLine, Cadre, PaymentClaim, PayPeriod, Staff, StaffAssignment, WorkLog, WorkLogAudit, utcnow
from ...services import worklog_workflow as wf
from ...services.scope import claim_visibility, staff_visibility, worklog_visibility
from .budgets import _visibility as budget_visibility

router = APIRouter()
DASHBOARD_ROLES = (OVERSIGHT, RPM, TECHNICAL_OFFICER, CSO_TECHNICAL, SUPERVISOR, FHI360_FINANCE, CSO_FINANCE, CENTRAL_ADMIN, REGIONAL_ADMIN, REGIONAL_FINANCE)


@router.get("")
def dashboard(
    period_id: Optional[int] = None,
    region_id: Optional[int] = None,
    cadre: Optional[str] = None,
    route: Optional[str] = None,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_roles(*DASHBOARD_ROLES)),
):
    period = db.get(PayPeriod, period_id) if period_id else None
    now = utcnow()
    reminder_after = get_setting(db, "reminder_after_hours")

    # Staff
    staff_q = db.query(Staff).filter(staff_visibility(current))
    if cadre:
        staff_q = staff_q.join(Cadre, Cadre.id == Staff.cadre_id).filter(Cadre.code == cadre)
    if region_id:
        staff_q = staff_q.filter(Staff.id.in_(db.query(StaffAssignment.staff_id).filter(StaffAssignment.region_id == region_id)))
    staff_by_status = dict(staff_q.with_entities(Staff.status, func.count(Staff.id)).group_by(Staff.status).all())
    mid_period_exits = rotations = 0
    if period:
        mid_period_exits = staff_q.filter(Staff.employment_end_date >= period.start_date, Staff.employment_end_date < period.end_date).count()
        rotations = db.query(StaffAssignment).filter(
            StaffAssignment.staff_id.in_(staff_q.with_entities(Staff.id)),
            StaffAssignment.start_date > period.start_date, StaffAssignment.start_date <= period.end_date,
        ).count()

    # Work logs
    log_q = db.query(WorkLog).filter(worklog_visibility(current))
    if period_id:
        log_q = log_q.filter(WorkLog.period_id == period_id)
    if cadre:
        log_q = log_q.join(Cadre, Cadre.id == WorkLog.cadre_id).filter(Cadre.code == cadre)
    if region_id:
        log_q = log_q.filter(WorkLog.assignment_id.in_(db.query(StaffAssignment.id).filter(StaffAssignment.region_id == region_id)))
    age = func.extract("epoch", literal(now, DateTime(timezone=True)) - WorkLog.status_changed_at) / 3600
    by_age = {row.status: row for row in log_q.with_entities(
        WorkLog.status, func.count(WorkLog.id).label("count"), func.max(age).label("oldest"), func.avg(age).label("average"),
        func.count(WorkLog.id).filter(age > 48).label("over_48h"),
        func.count(WorkLog.id).filter(age >= reminder_after).label("over_threshold"),
    ).group_by(WorkLog.status)}
    by_status = {status: row.count for status, row in by_age.items()}
    queues = []
    for status, owner in wf.STAGE_OWNER.items():
        row = by_age.get(status)
        queues.append({
            "status": status,
            "owner": owner,
            "count": row.count if row else 0,
            "max_age_hours": round(float(row.oldest), 1) if row else 0,
            "avg_age_hours": round(float(row.average), 1) if row else 0,
            "over_48h": row.over_48h if row else 0,
            "over_threshold": row.over_threshold if row else 0,
        })
    active = staff_by_status.get("ACTIVE", 0)
    with_log = staff_q.filter(Staff.status == "ACTIVE", Staff.id.in_(
        log_q.filter(WorkLog.status != wf.CANCELLED).with_entities(WorkLog.staff_id))).count()
    reasons = (
        db.query(WorkLogAudit.action, func.count())
        .filter(WorkLogAudit.work_log_id.in_(log_q.with_entities(WorkLog.id)), WorkLogAudit.action.in_(("return", "return_to_reviewer", "reject", "hold", "reopen", "decline")))
        .group_by(WorkLogAudit.action)
        .all()
    )

    # Claims and payments
    claim_q = db.query(PaymentClaim).filter(claim_visibility(current))
    if period_id:
        claim_q = claim_q.filter(PaymentClaim.period_id == period_id)
    if route:
        claim_q = claim_q.filter(PaymentClaim.route_code == route)
    if cadre:
        claim_q = claim_q.filter(PaymentClaim.staff_id.in_(db.query(Staff.id).join(Cadre, Cadre.id == Staff.cadre_id).filter(Cadre.code == cadre)))
    if region_id:
        claim_q = claim_q.filter(PaymentClaim.assignment_id.in_(db.query(StaffAssignment.id).filter(StaffAssignment.region_id == region_id)))
    claim_totals: dict[str, dict] = {}
    claim_groups = claim_q.with_entities(
        PaymentClaim.route_code, PaymentClaim.status, PaymentClaim.payment_status, func.count(PaymentClaim.id), func.sum(PaymentClaim.amount),
    ).group_by(PaymentClaim.route_code, PaymentClaim.status, PaymentClaim.payment_status)
    for route_code, status, payment_status, count, amount in claim_groups:
        bucket = claim_totals.setdefault(route_code or "UNROUTED", {"by_status": {}, "by_payment_status": {}, "count": 0})
        bucket["count"] += count
        for field, value in (("by_status", status), ("by_payment_status", payment_status)):
            entry = bucket[field].setdefault(value, {"count": 0, "amount": 0.0})
            entry["count"] += count
            entry["amount"] += float(amount)

    # Budgets
    budget_q = db.query(BudgetLine).filter(budget_visibility(current)) if current.has_any(FHI360_FINANCE, CSO_FINANCE, RPM, OVERSIGHT) else None
    budgets = []
    if budget_q is not None:
        if period_id:
            budget_q = budget_q.filter(BudgetLine.period_id == period_id)
        if region_id:
            budget_q = budget_q.filter(or_(BudgetLine.region_id.is_(None), BudgetLine.region_id == region_id))
        lines, allocated, committed, spent, unsynced = budget_q.with_entities(
            func.count(BudgetLine.id),
            func.coalesce(func.sum(BudgetLine.allocated_amount), 0),
            func.coalesce(func.sum(BudgetLine.committed_amount), 0),
            func.coalesce(func.sum(BudgetLine.spent_amount), 0),
            func.count(BudgetLine.id).filter(BudgetLine.sync_status.in_(("UNSYNCED", "ERROR"))),
        ).one()
        held = claim_q.filter(PaymentClaim.status.in_(("HELD", "BUDGET_HOLD"))).count()
        budgets = {
            "allocated": float(allocated),
            "committed": float(committed),
            "spent": float(spent),
            "remaining": float(allocated - committed - spent),
            "lines": lines,
            "claims_on_hold": held,
            "unsynced_tracker_lines": unsynced,
        }

    return {
        "staff": {
            "total": sum(staff_by_status.values()),
            "active": active,
            "exited": staff_by_status.get("EXITED", 0),
            "mid_period_exits": mid_period_exits,
            "rotations_in_period": rotations,
        },
        "work_logs": {
            "reminder_after_hours": reminder_after,
            "by_status": by_status,
            "queues": queues,
            "completeness": {
                "active_staff": active,
                "with_log": with_log,
                "missing": active - with_log if period_id else None,
            },
            "exceptions": {action: count for action, count in reasons},
        },
        "claims": claim_totals,
        "budgets": budgets,
    }
