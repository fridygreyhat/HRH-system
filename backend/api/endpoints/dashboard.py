"""Oversight dashboard. Every figure respects the caller's scope (a CSO sees only its own numbers)."""
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ...core.roles import CSO_FINANCE, FHI360_FINANCE, OVERSIGHT, RPM, TECHNICAL_OFFICER, SUPERVISOR, CENTRAL_ADMIN, REGIONAL_ADMIN, REGIONAL_FINANCE
from ...core.security import CurrentUser, require_roles
from ...core.settings import get_setting
from ...db.session import get_db
from ...models import BudgetLine, Cadre, PaymentClaim, PayPeriod, Staff, StaffAssignment, WorkLog, WorkLogAudit, utcnow
from ...services import worklog_workflow as wf
from ...services.scope import claim_visibility, staff_visibility, worklog_visibility
from .budgets import _visibility as budget_visibility

router = APIRouter()
DASHBOARD_ROLES = (OVERSIGHT, RPM, TECHNICAL_OFFICER, SUPERVISOR, FHI360_FINANCE, CSO_FINANCE, CENTRAL_ADMIN, REGIONAL_ADMIN, REGIONAL_FINANCE)


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
    staff_rows = staff_q.all()
    mid_period_exits = [s for s in staff_rows if period and s.employment_end_date and period.start_date <= s.employment_end_date < period.end_date]
    rotations = 0
    if period:
        rotations = db.query(StaffAssignment).filter(
            StaffAssignment.staff_id.in_([s.id for s in staff_rows] or [-1]),
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
    logs = log_q.all()
    by_status: dict[str, int] = {}
    for log in logs:
        by_status[log.status] = by_status.get(log.status, 0) + 1
    queues = []
    for status, owner in wf.STAGE_OWNER.items():
        ages = [(now - l.status_changed_at).total_seconds() / 3600 for l in logs if l.status == status]
        queues.append({
            "status": status,
            "owner": owner,
            "count": len(ages),
            "max_age_hours": round(max(ages), 1) if ages else 0,
            "avg_age_hours": round(sum(ages) / len(ages), 1) if ages else 0,
            "over_48h": sum(1 for a in ages if a > 48),
            "over_threshold": sum(1 for a in ages if a >= reminder_after),
        })
    active_ids = {s.id for s in staff_rows if s.status == "ACTIVE"}
    logged_ids = {l.staff_id for l in logs if l.status != wf.CANCELLED}
    log_ids = [l.id for l in logs] or [-1]
    reasons = (
        db.query(WorkLogAudit.action, func.count())
        .filter(WorkLogAudit.work_log_id.in_(log_ids), WorkLogAudit.action.in_(("return", "return_to_reviewer", "reject", "hold", "reopen", "decline")))
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
    for c in claim_q.all():
        key = c.route_code or "UNROUTED"
        bucket = claim_totals.setdefault(key, {"by_status": {}, "by_payment_status": {}, "count": 0})
        bucket["count"] += 1
        for field, value in (("by_status", c.status), ("by_payment_status", c.payment_status)):
            entry = bucket[field].setdefault(value, {"count": 0, "amount": 0.0})
            entry["count"] += 1
            entry["amount"] += float(c.amount)

    # Budgets
    budget_q = db.query(BudgetLine).filter(budget_visibility(current)) if current.has_any(FHI360_FINANCE, CSO_FINANCE, RPM, OVERSIGHT) else None
    budgets = []
    if budget_q is not None:
        if period_id:
            budget_q = budget_q.filter(BudgetLine.period_id == period_id)
        if region_id:
            budget_q = budget_q.filter(or_(BudgetLine.region_id.is_(None), BudgetLine.region_id == region_id))
        rows = budget_q.all()
        held = claim_q.filter(PaymentClaim.status.in_(("HELD", "BUDGET_HOLD"))).count()
        budgets = {
            "allocated": float(sum(b.allocated_amount for b in rows)),
            "committed": float(sum(b.committed_amount for b in rows)),
            "spent": float(sum(b.spent_amount for b in rows)),
            "remaining": float(sum(b.allocated_amount - b.committed_amount - b.spent_amount for b in rows)),
            "lines": len(rows),
            "claims_on_hold": held,
            "unsynced_tracker_lines": sum(1 for b in rows if b.sync_status in ("UNSYNCED", "ERROR")),
        }

    return {
        "staff": {
            "total": len(staff_rows),
            "active": len(active_ids),
            "exited": sum(1 for s in staff_rows if s.status == "EXITED"),
            "mid_period_exits": len(mid_period_exits),
            "rotations_in_period": rotations,
        },
        "work_logs": {
            "reminder_after_hours": reminder_after,
            "by_status": by_status,
            "queues": queues,
            "completeness": {
                "active_staff": len(active_ids),
                "with_log": len(active_ids & logged_ids),
                "missing": len(active_ids - logged_ids) if period_id else None,
            },
            "exceptions": {action: count for action, count in reasons},
        },
        "claims": claim_totals,
        "budgets": budgets,
    }
