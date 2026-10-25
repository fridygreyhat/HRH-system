"""Provider-originated community claims: frozen rates, scoped verification, CSO approval.

This is an explicit exception to the work-log finance gate, not a way to create
ordinary Services/Payroll claims or change any legacy claim's approval history.
"""
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy import or_

from ..core.roles import COMMUNITY_VERIFIER, CSO_FINANCE, PROVIDER, TECHNICAL_OFFICER
from ..models import ClaimCategory, ClaimComponent, PaymentClaim, PaymentRoute, PayPeriod, RateRule, Staff, StaffAssignment, utcnow
from . import budgets, claims as cl, cso_regions
from .scope import assignment_for_period, assignment_in_role_scope
from .v22_scope import may_manage


def is_direct(claim):
    return claim.workflow_version >= 2 and claim.work_type == "COMMUNITY" and claim.route_code == "C" and claim.work_log_id is None


def provider(current):
    if PROVIDER not in current.roles or current.staff is None:
        raise HTTPException(403, "A linked provider account is required")
    return current.staff


def context(db, current, period_id, category_id=None):
    staff = provider(current)
    period = db.get(PayPeriod, period_id)
    if not period or period.status != "OPEN":
        raise HTTPException(422, "Choose an open pay period")
    assignment = assignment_for_period(db, staff.id, period)
    if not assignment:
        raise HTTPException(422, "No provider assignment covers this regional pay period")
    if period.region_id is None and db.query(PayPeriod.id).filter(
        PayPeriod.region_id == assignment.region_id, PayPeriod.start_date <= period.end_date,
        PayPeriod.end_date >= period.start_date,
    ).first():
        raise HTTPException(409, "Use the regional pay period instead of a global schedule")
    category = None
    if category_id is not None:
        category = db.query(ClaimCategory).join(PaymentRoute, PaymentRoute.id == ClaimCategory.route_id).filter(
            ClaimCategory.id == category_id, ClaimCategory.is_active.is_(True),
            ClaimCategory.requires_work_log.is_(False), ClaimCategory.origin_channel == "COMMUNITY",
            PaymentRoute.code == "C",
        ).first()
        if not category:
            raise HTTPException(422, "Select a configured direct community category; ordinary Services and Payroll cannot use this path")
    return staff, period, assignment, category


def approved_rules(db, category, staff, period, assignment):
    candidates = db.query(RateRule).filter(
        RateRule.category_id == category.id, RateRule.status == "ACTIVE",
        RateRule.approved_by.isnot(None), RateRule.approved_at.isnot(None),
        or_(RateRule.cadre_id.is_(None), RateRule.cadre_id == staff.cadre_id),
        or_(RateRule.region_id.is_(None), RateRule.region_id == assignment.region_id),
        RateRule.effective_start_date <= period.start_date,
        or_(RateRule.effective_end_date.is_(None), RateRule.effective_end_date >= period.end_date),
    ).all()
    if not candidates:
        raise HTTPException(422, "No approved community rates cover this cadre, region and entire pay period")
    best = {}
    for rule in candidates:
        score = int(rule.cadre_id is not None) + int(rule.region_id is not None)
        existing = best.get(rule.component_name)
        if existing is None or score > existing[0]:
            best[rule.component_name] = (score, [rule])
        elif score == existing[0]:
            existing[1].append(rule)
    if any(len(matches) != 1 for _, matches in best.values()):
        raise HTTPException(422, "Ambiguous approved community rates; resolve overlapping rules before creating a claim")
    return [matches[0] for _, matches in sorted(best.values(), key=lambda item: item[1][0].component_name)]


def unit_key(component):
    return {"PER_DAY": "days", "PER_HOUR": "hours", "PER_UNIT": component["measure_key"], "FIXED": None}[component["unit_type"]]


def unit_fields(components):
    fields = {}
    for component in components:
        key = unit_key(component)
        if key:
            fields[key] = {"key": key, "label": key.replace("_", " ").capitalize(), "unit_type": component["unit_type"]}
    return list(fields.values())


def calculate(components, declared):
    expected = {unit_key(c) for c in components} - {None}
    if set(declared) != expected:
        raise HTTPException(422, f"Enter exactly the configured community units: {', '.join(sorted(expected)) or 'none (fixed rate)'}")
    priced, currencies, total = [], set(), Decimal(0)
    for component in components:
        key = unit_key(component)
        units = Decimal(str(declared[key])) if key else Decimal(1)
        if not units.is_finite() or units < 0 or units > 1000000000:
            raise HTTPException(422, "Declared work units must be finite, non-negative and within the supported limit")
        if component["unit_type"] in {"PER_DAY", "PER_UNIT"} and units != units.to_integral_value():
            raise HTTPException(422, "Days and activity counts must be whole numbers")
        amount = (units * Decimal(str(component["rate"]))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if component.get("cap_amount") is not None:
            amount = min(amount, Decimal(str(component["cap_amount"])))
        if amount < 0:
            raise HTTPException(422, "The approved community rate or cap is invalid")
        priced.append({**component, "units": units, "amount": amount})
        currencies.add(component["currency"])
        total += amount
    if len(currencies) != 1 or total <= 0 or total > Decimal("9999999999999.99"):
        raise HTTPException(422, "A community claim requires a positive supported amount in one currency")
    return priced, total, next(iter(currencies))


def quote(db, current, period_id, category_id, declared):
    staff, period, assignment, category = context(db, current, period_id, category_id)
    if not category.funding_source_id:
        raise HTTPException(422, "The community category needs a configured funding source")
    cso_regions.require_assignment(db, assignment.organization_id, assignment.region_id)
    line = budgets.find_line(db, category.id, period.id, assignment.organization_id, assignment.region_id, strict_region=True)
    if not line:
        raise HTTPException(422, "Configure a CSO-owned budget for this exact region, category and pay period")
    components = [{
        "rate_rule_id": rule.id, "component_name": rule.component_name, "unit_type": rule.unit_type,
        "measure_key": rule.measure_key, "rate": rule.rate_value, "cap_amount": rule.cap_amount,
        "currency": rule.currency, "effective_start_date": rule.effective_start_date,
    } for rule in approved_rules(db, category, staff, period, assignment)]
    components, amount, currency = calculate(components, declared)
    if currency != line.currency:
        raise HTTPException(422, "The captured rate currency does not match the regional CSO budget")
    return staff, period, assignment, category, line, components, amount, currency


def save_components(db, claim, components):
    db.query(ClaimComponent).filter_by(claim_id=claim.id).delete()
    for c in components:
        db.add(ClaimComponent(claim_id=claim.id, **{key: c[key] for key in (
            "rate_rule_id", "component_name", "unit_type", "measure_key", "units", "rate", "amount",
        )}))


def check_authority(db, claim, *, lock=False):
    assignment = db.get(StaffAssignment, claim.assignment_id)
    snapshot = claim.calculation_snapshot or {}
    if not assignment or assignment.region_id != snapshot.get("region_id") or assignment.organization_id != claim.executor_org_id:
        raise HTTPException(409, "The captured community assignment changed; cancel and prepare a correctly assigned claim")
    cso_regions.require_assignment(db, claim.executor_org_id, assignment.region_id, lock=lock)
    category = db.get(ClaimCategory, claim.category_id)
    route = db.get(PaymentRoute, category.route_id) if category else None
    if not category or not category.is_active or category.requires_work_log or category.origin_channel != "COMMUNITY" or not route or route.code != "C":
        raise HTTPException(409, "This category is no longer configured for direct community claims")
    line = budgets.find_line(db, category.id, claim.period_id, claim.executor_org_id, assignment.region_id, strict_region=True)
    if not line or line.id != claim.budget_line_id or line.currency != claim.currency:
        raise HTTPException(409, "The regional CSO budget configuration changed; do not charge a different allocation")
    return assignment


def check_action(db, current, claim, action):
    own = current.staff_id == claim.staff_id and current.id == claim.created_by and PROVIDER in current.roles
    if current.staff_id == claim.staff_id:
        if own and action == "submit" and claim.status in {cl.DRAFT, cl.VALIDATION_NEEDED}:
            return None
        if own and action == "cancel" and claim.status in {cl.DRAFT, cl.VALIDATION_NEEDED, cl.PENDING_COMMUNITY, cl.AWAITING_APPROVAL}:
            return None
        return "You cannot verify, approve or pay your own community claim"
    assignment = db.get(StaffAssignment, claim.assignment_id)
    cadre_id = (claim.calculation_snapshot or {}).get("cadre_id")
    verifier = (
        COMMUNITY_VERIFIER in current.roles and assignment_in_role_scope(db, current, COMMUNITY_VERIFIER, claim.assignment_id)
    ) or (
        TECHNICAL_OFFICER in current.roles and assignment and may_manage(current, assignment.region_id, cadre_id)
    )
    if action == "verify_community" or (action == "send_back" and claim.status == cl.PENDING_COMMUNITY):
        return None if verifier and claim.status == cl.PENDING_COMMUNITY else "Only the assigned Community Verifier or scoped Technical Officer can verify or return this pending claim"
    finance_error = cl.finance_role_ok(current, claim)
    if finance_error:
        return finance_error
    if action == "cancel":
        from .payments import paid_total
        if paid_total(db, claim.id) > 0:
            return "A community claim with recorded funds cannot be cancelled"
    if action in {"approve", "send_back"} and claim.status == cl.AWAITING_APPROVAL:
        if current.id in {claim.created_by, claim.verified_by}:
            return "CSO approval must be independent of the provider and verifier"
        return None if claim.verified_at else "Community verification is required before CSO approval"
    if action == "release" and claim.status == cl.BUDGET_HOLD:
        return None if claim.approved_at and current.id not in {claim.created_by, claim.verified_by} else "An independent CSO finance officer must release this budget hold"
    if action == "cancel" and claim.status in cl.CANCELLABLE and claim.payment_status in {"NOT_STARTED", "FAILED"}:
        return None
    return f"Cannot {action} this community claim in status {claim.status}"


def perform(db, current, claim, action, comment):
    error = check_action(db, current, claim, action)
    if error:
        raise HTTPException(409 if error.startswith("Cannot") else 403, error)
    if action in {"send_back", "cancel", "release"} and not (comment or "").strip():
        raise HTTPException(422, f"A reason is required to '{action}'")
    old, old_pay = claim.status, claim.payment_status
    role, details = CSO_FINANCE, None
    if action == "submit":
        context(db, current, claim.period_id, claim.category_id)
        check_authority(db, claim)
        claim.status, claim.exception_reason = cl.PENDING_COMMUNITY, None
        role = PROVIDER
    elif action == "verify_community":
        check_authority(db, claim)
        claim.verified_by, claim.verified_at = current.id, utcnow()
        claim.status = cl.AWAITING_APPROVAL
        role = COMMUNITY_VERIFIER if COMMUNITY_VERIFIER in current.roles and assignment_in_role_scope(db, current, COMMUNITY_VERIFIER, claim.assignment_id) else TECHNICAL_OFFICER
    elif action == "send_back":
        claim.status, claim.exception_reason = cl.VALIDATION_NEEDED, comment
        claim.verified_by, claim.verified_at = None, None
        claim.approved_by, claim.approved_at = None, None
        role = (COMMUNITY_VERIFIER if COMMUNITY_VERIFIER in current.roles else TECHNICAL_OFFICER) if old == cl.PENDING_COMMUNITY else CSO_FINANCE
    elif action in {"approve", "release"}:
        check_authority(db, claim, lock=True)
        if action == "approve":
            staff = db.get(Staff, claim.staff_id)
            if not staff.payment_account or not staff.payment_method:
                raise HTTPException(422, "Configure the provider's bank or mobile-money payment details before approving")
            claim.approved_by, claim.approved_at = current.id, utcnow()
            claim.calculation_snapshot = {**claim.calculation_snapshot, "authorized_at": claim.approved_at.isoformat()}
        details = cl._commit_budget(db, current, claim)
        if claim.status == cl.APPROVED:
            claim.status = cl.READY
    elif action == "cancel":
        if old in cl.COMMITTED_STATUSES:
            budgets.release(db, claim.budget_line_id, claim.amount, claim.id, current.id, comment)
        claim.status = cl.CANCELLED
        if current.staff_id == claim.staff_id:
            role = PROVIDER
    cl.audit(db, current, claim, action, role, old, old_pay, comment, details)
    db.flush()
    return claim
