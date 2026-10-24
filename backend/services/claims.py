"""Payment claims: routing (A/B/C), rate calculation, approval and budget control.

A work log records work; a claim records a liability. A claim is priced only from ACTIVE, approved,
effective-dated rate rules. Anything missing (route, payor, CSO, funding source, rule, budget line)
becomes a visible exception — never a guessed value.

Claim status:   DRAFT | VALIDATION_NEEDED | PENDING_COMMUNITY_VERIFICATION | AWAITING_APPROVAL
                | APPROVED | BUDGET_HOLD | READY | EXPORTED | HANDED_OFF | CANCELLED
Payment status: NOT_STARTED | PENDING | PARTIALLY_RECORDED | PROOF_REQUIRED | PAID | FAILED | RECONCILED
"""
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..core.roles import COMMUNITY_VERIFIER, CSO_FINANCE, FHI360_FINANCE, RPM
from ..core.security import CurrentUser
from ..models import (
    ClaimAudit,
    ClaimCategory,
    ClaimComponent,
    Organization,
    PaymentClaim,
    PaymentRoute,
    PayPeriod,
    RateRule,
    Staff,
    StaffAssignment,
    WorkLog,
    WorkLogEntry,
    WorkLogMeasure,
    utcnow,
)
from . import budgets, notifications
from .forms import cadre_fields
from .scope import assignment_in_role_scope, users_in_scope_for

DRAFT = "DRAFT"
VALIDATION_NEEDED = "VALIDATION_NEEDED"
PENDING_COMMUNITY = "PENDING_COMMUNITY_VERIFICATION"
AWAITING_APPROVAL = "AWAITING_APPROVAL"
APPROVED = "APPROVED"
BUDGET_HOLD = "BUDGET_HOLD"
HELD = BUDGET_HOLD  # compatibility for service callers using the old constant
READY = "READY"
EXPORTED = "EXPORTED"
HANDED_OFF = "HANDED_OFF"
CANCELLED = "CANCELLED"
CLAIM_STATUSES = [DRAFT, VALIDATION_NEEDED, PENDING_COMMUNITY, AWAITING_APPROVAL, APPROVED, HELD, READY, EXPORTED, HANDED_OFF, CANCELLED]
PAYMENT_STATUSES = ["NOT_STARTED", "PENDING", "PARTIALLY_RECORDED", "PROOF_REQUIRED", "PAID", "FAILED", "RECONCILED"]
COMMITTED_STATUSES = {APPROVED, READY, EXPORTED, HANDED_OFF}
CANCELLABLE = {DRAFT, VALIDATION_NEEDED, PENDING_COMMUNITY, AWAITING_APPROVAL, APPROVED, HELD, "HELD", READY}

# Who prepares/approves claims on each route (approver must be a different person from the preparer).
ROUTE_FINANCE_ROLE = {"A": FHI360_FINANCE, "B": FHI360_FINANCE, "C": CSO_FINANCE}
# Who records payment execution on each route.
ROUTE_EXECUTOR_ROLE = {"A": FHI360_FINANCE, "B": CSO_FINANCE, "C": CSO_FINANCE}


@dataclass
class Resolution:
    route_code: Optional[str] = None
    funding_source_id: Optional[int] = None
    payor_org_id: Optional[int] = None
    executor_org_id: Optional[int] = None
    budget_line_id: Optional[int] = None
    origin_channel: Optional[str] = None
    components: list[dict] = field(default_factory=list)
    exceptions: list[str] = field(default_factory=list)

    @property
    def amount(self) -> Decimal:
        return sum((c["amount"] for c in self.components), Decimal(0))


def resolve(
    db: Session,
    category: ClaimCategory,
    staff: Staff,
    period: PayPeriod,
    assignment: Optional[StaffAssignment],
    work_log: Optional[WorkLog],
    declared_units: Optional[dict],
) -> Resolution:
    r = Resolution(origin_channel=category.origin_channel, funding_source_id=category.funding_source_id)
    route = db.get(PaymentRoute, category.route_id) if category.route_id else None
    if not route:
        r.exceptions.append(f"Category '{category.name}' has no payment route configured")
    else:
        r.route_code = route.code
    if not category.funding_source_id:
        r.exceptions.append(f"Category '{category.name}' has no funding source configured")
    if not assignment:
        r.exceptions.append("Staff member has no assignment covering this period")

    assigned_org = db.get(Organization, assignment.organization_id) if assignment and assignment.organization_id else None
    if r.route_code in ("A", "B"):
        if not category.payor_org_id:
            r.exceptions.append(f"Category '{category.name}' has no payor configured")
        r.payor_org_id = category.payor_org_id
    if r.route_code == "A":
        r.executor_org_id = category.payor_org_id
    elif r.route_code in ("B", "C"):
        if not assigned_org or assigned_org.type != "CSO":
            r.exceptions.append("Staff assignment for this period has no CSO; Route B/C needs the assigned CSO")
        else:
            r.executor_org_id = assigned_org.id
        if r.route_code == "C":
            r.payor_org_id = r.executor_org_id

    owner = r.payor_org_id if category.budget_owner == "PAYOR" else r.executor_org_id
    if owner:
        line = budgets.find_line(db, category.id, period.id, owner, assignment.region_id if assignment else None)
        if line:
            r.budget_line_id = line.id
        else:
            r.exceptions.append(f"No budget line configured for '{category.name}' in {period.period_label or period.start_date} for the budget owner")

    r.components, calc_exceptions = calculate(db, category, staff, period, assignment, work_log, declared_units)
    r.exceptions.extend(calc_exceptions)
    return r


def calculate(db, category, staff, period, assignment, work_log, declared_units) -> tuple[list[dict], list[str]]:
    region_id = assignment.region_id if assignment else None
    rules = (
        db.query(RateRule)
        .filter(
            RateRule.category_id == category.id,
            RateRule.status == "ACTIVE",
            or_(RateRule.cadre_id.is_(None), RateRule.cadre_id == staff.cadre_id),
            or_(RateRule.region_id.is_(None), RateRule.region_id == region_id),
            RateRule.effective_start_date <= period.end_date,
            or_(RateRule.effective_end_date.is_(None), RateRule.effective_end_date >= period.start_date),
        )
        .all()
    )
    if not rules:
        return [], [f"No active approved rate rule for '{category.name}' matching this cadre, region and period"]

    best: dict[str, RateRule] = {}
    for rule in rules:
        specificity = (rule.cadre_id is not None) + (rule.region_id is not None)
        current = best.get(rule.component_name)
        if current is None or specificity > (current.cadre_id is not None) + (current.region_id is not None):
            best[rule.component_name] = rule

    exceptions: list[str] = []
    form_keys = {f.key for f in cadre_fields(db, staff.cadre_id)}
    components = []
    for name, rule in sorted(best.items()):
        units = _units(db, rule, work_log, declared_units, form_keys, exceptions)
        if units is None:
            continue
        amount = (units * rule.rate_value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if rule.cap_amount is not None:
            amount = min(amount, rule.cap_amount)
        components.append(
            {
                "rate_rule_id": rule.id,
                "component_name": name,
                "unit_type": rule.unit_type,
                "measure_key": rule.measure_key,
                "units": units,
                "rate": rule.rate_value,
                "cap_amount": rule.cap_amount,
                "amount": amount,
                "currency": rule.currency,
                "effective_start_date": rule.effective_start_date,
            }
        )
    return components, exceptions


def estimate_for_work_log(db: Session, log: WorkLog) -> dict:
    """What the log would earn under today's active, approved rate rules. Only a claim sets the amount actually paid."""
    staff = db.get(Staff, log.staff_id)
    period = db.get(PayPeriod, log.period_id)
    assignment = db.get(StaffAssignment, log.assignment_id) if log.assignment_id else None
    lines, totals = [], {}
    categories = db.query(ClaimCategory).filter(ClaimCategory.is_active.is_(True), ClaimCategory.requires_work_log.is_(True)).order_by(ClaimCategory.name)
    for category in categories:
        components, _ = calculate(db, category, staff, period, assignment, log, None)
        for c in components:
            lines.append({"category": category.name, "component": c["component_name"], "units": c["units"], "rate": c["rate"], "amount": c["amount"], "currency": c["currency"]})
            totals[c["currency"]] = totals.get(c["currency"], Decimal(0)) + c["amount"]
    return {"lines": lines, "totals": [{"currency": k, "amount": v} for k, v in sorted(totals.items())]}


def _units(db, rule: RateRule, work_log, declared, form_keys, exceptions) -> Optional[Decimal]:
    if rule.unit_type == "FIXED":
        return Decimal(1)
    if work_log is None:
        key = {"PER_DAY": "days", "PER_HOUR": "hours"}.get(rule.unit_type, rule.measure_key)
        if not declared or key not in declared:
            exceptions.append(f"Declared units for '{key}' are required for '{rule.component_name}'")
            return None
        return Decimal(str(declared[key]))
    if rule.unit_type == "PER_DAY":
        return Decimal(db.query(func.count(WorkLogEntry.id)).filter(WorkLogEntry.work_log_id == work_log.id).scalar())
    if rule.unit_type == "PER_HOUR":
        return Decimal(db.query(func.coalesce(func.sum(WorkLogEntry.hours_worked), 0)).filter(WorkLogEntry.work_log_id == work_log.id).scalar())
    if rule.measure_key not in form_keys:
        exceptions.append(f"Rate rule '{rule.component_name}' counts '{rule.measure_key}', which is not on this cadre's work-log form")
        return None
    return Decimal(
        db.query(func.coalesce(func.sum(WorkLogMeasure.value), 0))
        .join(WorkLogEntry, WorkLogEntry.id == WorkLogMeasure.entry_id)
        .filter(WorkLogEntry.work_log_id == work_log.id, WorkLogMeasure.field_key == rule.measure_key)
        .scalar()
    )


def apply_resolution(db: Session, claim: PaymentClaim, r: Resolution) -> None:
    claim.route_code = r.route_code
    claim.funding_source_id = r.funding_source_id
    claim.payor_org_id = r.payor_org_id
    claim.executor_org_id = r.executor_org_id
    claim.budget_line_id = r.budget_line_id
    claim.origin_channel = r.origin_channel
    claim.amount = r.amount
    if r.components and r.components[0]["currency"]:
        claim.currency = r.components[0]["currency"]
    claim.exception_reason = "; ".join(r.exceptions) or None
    db.query(ClaimComponent).filter(ClaimComponent.claim_id == claim.id).delete()
    for c in r.components:
        db.add(
            ClaimComponent(
                claim_id=claim.id,
                rate_rule_id=c["rate_rule_id"],
                component_name=c["component_name"],
                unit_type=c["unit_type"],
                measure_key=c["measure_key"],
                units=c["units"],
                rate=c["rate"],
                amount=c["amount"],
            )
        )
    claim.status = settled_status(claim, r)


def settled_status(claim: PaymentClaim, r: Resolution) -> str:
    if r.exceptions or r.amount <= 0:
        if not r.exceptions:
            claim.exception_reason = "Calculated amount is zero"
        return VALIDATION_NEEDED
    if needs_community_verification(claim) and not claim.verified_at:
        return PENDING_COMMUNITY
    return DRAFT


def needs_community_verification(claim: PaymentClaim) -> bool:
    return claim.work_log_id is None and claim.route_code == "C"


def resolve_for_claim(db: Session, claim: PaymentClaim) -> Resolution:
    return resolve(
        db,
        db.get(ClaimCategory, claim.category_id),
        db.get(Staff, claim.staff_id),
        db.get(PayPeriod, claim.period_id),
        db.get(StaffAssignment, claim.assignment_id) if claim.assignment_id else None,
        db.get(WorkLog, claim.work_log_id) if claim.work_log_id else None,
        claim.declared_units,
    )


def audit(db: Session, current: Optional[CurrentUser], claim: PaymentClaim, action: str, role: Optional[str], old_status, old_payment, comment=None, details=None):
    db.add(
        ClaimAudit(
            claim_id=claim.id,
            actor_id=current.id if current else None,
            actor_role=role,
            action=action,
            old_status=old_status,
            new_status=claim.status,
            old_payment_status=old_payment,
            new_payment_status=claim.payment_status,
            comment=comment,
            details=jsonable_encoder(details) if details is not None else None,
        )
    )


def user_in_executor_org(current: CurrentUser, claim: PaymentClaim) -> bool:
    return claim.executor_org_id in current.scope_values("organization_id")


def finance_role_ok(current: CurrentUser, claim: PaymentClaim) -> Optional[str]:
    """The route's finance role; CSO users must belong to the claim's CSO."""
    role = finance_role(claim)
    if role is None:
        return None if claim.created_by == current.id and current.has_any(FHI360_FINANCE, CSO_FINANCE) else "Route not configured"
    if role not in current.roles:
        return f"Requires the {role} role"
    if role == CSO_FINANCE and not user_in_executor_org(current, claim):
        return "This claim belongs to another CSO"
    return None


def finance_role(claim):
    if claim.workflow_version >= 2:
        return FHI360_FINANCE if claim.work_type == "SERVICES" else CSO_FINANCE
    return ROUTE_FINANCE_ROLE.get(claim.route_code or "")


def check_action(db: Session, current: CurrentUser, claim: PaymentClaim, action: str) -> Optional[str]:
    if current.staff_id == claim.staff_id:
        return "You cannot act on your own claim"
    s = claim.status
    if claim.workflow_version >= 2:
        if action not in {"cancel"}:
            return "New claims are validated and routed through the Regional Finance work-log gate"
        if claim.payment_status not in {"NOT_STARTED", "FAILED"}:
            return "A claim with recorded payments cannot be cancelled"
    if action == "verify_community":
        if s != PENDING_COMMUNITY:
            return f"Cannot verify a claim in status {s}"
        if COMMUNITY_VERIFIER not in current.roles:
            return f"Requires the {COMMUNITY_VERIFIER} role"
        return None if assignment_in_role_scope(db, current, COMMUNITY_VERIFIER, claim.assignment_id) else "Outside your community area"
    if action == "revalidate":
        return finance_role_ok(current, claim) if s in (DRAFT, VALIDATION_NEEDED) else f"Cannot revalidate a claim in status {s}"
    if action == "submit":
        return finance_role_ok(current, claim) if s == DRAFT else f"Cannot submit a claim in status {s}"
    if action in ("approve", "send_back"):
        if s != AWAITING_APPROVAL:
            return f"Cannot {action} a claim in status {s}"
        if claim.created_by == current.id:
            return "The approver must be a different person from the preparer"
        return finance_role_ok(current, claim)
    if action == "release":
        if s not in {HELD, "HELD"}:
            return f"Cannot release a claim in status {s}"
        return None if RPM in current.roles and assignment_in_role_scope(db, current, RPM, claim.assignment_id) else finance_role_ok(current, claim)
    if action == "mark_ready":
        return finance_role_ok(current, claim) if s == APPROVED else f"Cannot mark ready a claim in status {s}"
    if action == "cancel":
        return finance_role_ok(current, claim) if s in CANCELLABLE else f"Cannot cancel a claim in status {s}"
    return f"Unknown action {action}"


CLAIM_ACTIONS = ["verify_community", "revalidate", "submit", "approve", "send_back", "release", "mark_ready", "cancel"]
COMMENT_REQUIRED = {"send_back", "cancel"}


def available_actions(db: Session, current: CurrentUser, claim: PaymentClaim) -> list[str]:
    return [a for a in CLAIM_ACTIONS if check_action(db, current, claim, a) is None]


def perform(db: Session, current: CurrentUser, claim: PaymentClaim, action: str, comment: Optional[str]) -> PaymentClaim:
    reason = check_action(db, current, claim, action)
    if reason:
        raise HTTPException(status_code=409 if reason.startswith("Cannot") else 403, detail=reason)
    if action in COMMENT_REQUIRED and not (comment and comment.strip()):
        raise HTTPException(status_code=422, detail=f"A reason is required to '{action}'")
    old, old_pay = claim.status, claim.payment_status
    role = finance_role(claim)
    details = None

    if action == "verify_community":
        claim.verified_by, claim.verified_at = current.id, utcnow()
        claim.status = DRAFT
        role = COMMUNITY_VERIFIER
    elif action == "revalidate":
        apply_resolution(db, claim, resolve_for_claim(db, claim))
    elif action == "submit":
        claim.status = AWAITING_APPROVAL
    elif action == "send_back":
        claim.status = VALIDATION_NEEDED
        claim.exception_reason = comment
    elif action == "approve":
        r = resolve_for_claim(db, claim)
        if r.exceptions or r.amount != claim.amount:
            raise HTTPException(status_code=409, detail="Configuration or rates changed since this claim was prepared. Send it back to be revalidated.")
        claim.calculation_snapshot = _snapshot(r)
        claim.approved_by, claim.approved_at = current.id, utcnow()
        details = _commit_budget(db, current, claim)
    elif action == "release":
        # Re-checks the budget (e.g. after a reallocation); stays HELD if still short.
        details = _commit_budget(db, current, claim)
        role = RPM if RPM in current.roles else role
    elif action == "mark_ready":
        claim.status = READY
    elif action == "cancel":
        if old in COMMITTED_STATUSES and claim.budget_line_id:
            budgets.release(db, claim.budget_line_id, claim.amount, claim.id, current.id, f"Claim cancelled: {comment}")
        claim.status = CANCELLED
    audit(db, current, claim, action, role, old, old_pay, comment, details)
    db.flush()
    return claim


def _commit_budget(db: Session, current: CurrentUser, claim: PaymentClaim) -> dict:
    try:
        line = budgets.commit(db, claim.budget_line_id, claim.amount, claim.id, current.id)
        claim.status = APPROVED
        claim.exception_reason = None
        return {"budget_line": line.code, "committed": str(claim.amount)}
    except budgets.InsufficientBudget as e:
        already_held = claim.status in {HELD, "HELD"}
        claim.status = HELD
        claim.exception_reason = f"Budget hold: line {e.line.code} is short by {e.shortfall} {e.line.currency}"
        assignment = db.get(StaffAssignment, claim.assignment_id) if claim.assignment_id else None
        if not already_held and assignment:
            period = db.get(PayPeriod, claim.period_id)
            staff = db.get(Staff, claim.staff_id)
            for reviewer in users_in_scope_for(db, RPM, assignment, strict_cadre=claim.workflow_version >= 2):
                notifications.enqueue(
                    db, "CLAIM_BUDGET_HOLD", reviewer, None,
                    related=("claim", claim.id, BUDGET_HOLD),
                    provider=staff.legal_name,
                    period=period.period_label or f"{period.start_date} to {period.end_date}",
                    claim_id=claim.id,
                )
        return {"budget_line": e.line.code, "shortfall": str(e.shortfall), "available": str(budgets.available(e.line))}


def _snapshot(r: Resolution) -> dict:
    return jsonable_encoder(
        {
            "route": r.route_code,
            "payor_org_id": r.payor_org_id,
            "executor_org_id": r.executor_org_id,
            "budget_line_id": r.budget_line_id,
            "components": r.components,
            "amount": r.amount,
            "authorized_at": utcnow(),
        }
    )
