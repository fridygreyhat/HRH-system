"""The v2 regional finance gate: snapshot → validate amount → route → payable claim."""
from decimal import Decimal, ROUND_HALF_UP
from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy import or_

from ..core.roles import REGIONAL_FINANCE, RPM
from ..models import ActivityRate, BudgetTransaction, ClaimCategory, ClaimComponent, FundingSource, Organization, PaymentClaim, PaymentRoute, PayPeriod, Staff, StaffAssignment, WorkLog, WorkLogEntry, utcnow
from . import claims, cso_regions
from .forms import entries_with_measures


def _quote_missing_daily_amount(db, log, activity, day):
    """Fill absent terms only, using exact service identity and work-date scope."""
    if activity.get("rate_value") is not None:
        return activity, None
    assignment = db.get(StaffAssignment, log.assignment_id)
    keys = {key for key in (activity.get("key"), activity.get("source_key")) if key}
    if not keys:
        return activity, None
    candidates = db.query(ActivityRate).filter(
        ActivityRate.cadre_id == log.cadre_id, ActivityRate.region_id == assignment.region_id,
        ActivityRate.item_type == "SERVICES", ActivityRate.unit_type == "PER_DAY",
        ActivityRate.effective_start_date <= day,
        or_(ActivityRate.key.in_(keys), ActivityRate.source_key.in_(keys)),
    ).order_by(ActivityRate.effective_start_date.desc(), ActivityRate.id.desc()).all()
    eligible = []
    for row in candidates:
        successor = db.query(ActivityRate).filter(ActivityRate.supersedes_id == row.id).first()
        if successor and day >= successor.effective_start_date:
            continue
        if not row.is_active and not successor:
            continue
        eligible.append(row)
    if not eligible:
        return activity, None
    latest = [row for row in eligible if row.effective_start_date == eligible[0].effective_start_date]
    if len(latest) != 1:
        return activity, f"{day}: {activity.get('label_en', 'Service')} has conflicting approved daily amounts. Resolve the rate configuration before payment."
    row = latest[0]
    return {**activity, "id": row.id, "rate_value": str(row.rate_value),
            "currency": row.currency, "unit_type": "PER_DAY",
            "rate_effective_start_date": str(row.effective_start_date)}, None


def preview(db, log) -> dict:
    # A finance claim is an immutable financial proposal/history. Later rate
    # setup must never silently reprice it, including completed payments.
    frozen = db.query(PaymentClaim).filter(
        PaymentClaim.work_log_id == log.id, PaymentClaim.status != claims.CANCELLED,
    ).order_by(PaymentClaim.id.desc()).first()
    snapshot = frozen.calculation_snapshot if frozen else None
    if snapshot and all(key in snapshot for key in ("lines", "total", "currency", "exceptions")):
        return deepcopy({key: snapshot[key] for key in ("lines", "total", "currency", "exceptions")})
    lines, exceptions, currencies = [], [], set()
    total = Decimal(0)
    for entry, measures in entries_with_measures(db, log.id):
        activity = deepcopy(entry.activity_snapshot or {})
        if log.workflow_version >= 2 and log.work_type == "SERVICES":
            activity, quote_error = _quote_missing_daily_amount(db, log, activity, entry.entry_date)
            quote_errors = [quote_error] if quote_error else []
            for extra in activity.get("additional_services", []):
                extra["activity"], quote_error = _quote_missing_daily_amount(db, log, extra["activity"], entry.entry_date)
                if quote_error:
                    quote_errors.append(quote_error)
            if quote_errors:
                exceptions.extend(quote_errors)
                continue
        if log.work_type == "SERVICES" and (activity.get("unit_type") == "PER_DAY" or activity.get("additional_services")):
            from .daily_services import fixed_daily_lines
            priced_entry = SimpleNamespace(activity_snapshot=activity, entry_date=entry.entry_date,
                                          activity_location=entry.activity_location)
            selected, errors = fixed_daily_lines(priced_entry, measures)
            exceptions.extend(errors)
            if not selected:
                continue
            activity = selected["activity"]
        name = activity.get("label_en", entry.activity_key or "Unspecified activity")
        rate = activity.get("rate_value")
        if rate is None:
            exceptions.append(f"{entry.entry_date}: {name} has no configured activity rate.")
            continue
        unit_type = activity.get("unit_type")
        if unit_type == "PER_HOUR":
            units = Decimal(entry.hours_worked)
        elif unit_type == "PER_DAY":
            units = Decimal(1)
        else:
            field = activity.get("billable_field")
            if not field or field not in measures:
                exceptions.append(f"{entry.entry_date}: {name} is missing its payable count.")
                continue
            units = measures[field]
        amount = (units * Decimal(str(rate))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        currency = activity.get("currency", "TZS")
        currencies.add(currency)
        lines.append({
            "entry_id": entry.id, "date": str(entry.entry_date), "activity": name,
            "activity_key": activity.get("key", entry.activity_key), "activity_rate_id": activity.get("id"),
            "unit_type": unit_type, "measure_key": activity.get("billable_field"),
            "rate_effective_start_date": activity.get("rate_effective_start_date"),
            "units": str(units), "rate": str(rate), "amount": str(amount), "currency": currency,
        })
        total += amount
    if not lines:
        exceptions.append("No priced activity entries are available.")
    if len(currencies) > 1:
        exceptions.append("A finance-reviewed work log must use one currency.")
    if total <= 0:
        exceptions.append("The validated payment amount must be greater than zero.")
    if total > Decimal("9999999999999.99"):
        exceptions.append("The validated amount exceeds the supported financial limit.")
    return {"lines": lines, "total": str(total), "currency": next(iter(currencies)) if len(currencies) == 1 else None, "exceptions": exceptions}


def eligible_payors(db, log, *, lock=False):
    """The selector is explicit, but cannot override the assignment or channel rule."""
    if log.work_type == "SERVICES":
        owners = db.query(Organization).filter(Organization.type == "FHI360", Organization.is_active.is_(True)).all()
        if len(owners) != 1:
            raise HTTPException(422, "Exactly one FHI360 payor organization must be configured")
        return owners
    assignment = db.get(StaffAssignment, log.assignment_id)
    owner = db.get(Organization, assignment.organization_id) if assignment and assignment.organization_id else None
    if not owner or owner.type != "CSO":
        raise HTTPException(422, "Payroll needs the provider's assigned CSO; it cannot be routed to FHI360")
    cso_regions.require_assignment(db, owner.id, assignment.region_id, lock=lock)
    return [owner]


def _context(db, log, category_id, funding_source_id=None):
    owner = eligible_payors(db, log)[0]
    if category_id is None:
        source = (db.query(FundingSource).filter_by(id=funding_source_id)
                  .with_for_update().first()) if funding_source_id else None
        if not source:
            raise HTTPException(422, "Select a configured funding programme: PnP, Supply Chain or EpiC.")
        # A technical claim identity, not a budget or a user-maintained category.
        # Serializing on the source prevents duplicate creation by two reviewers.
        name = f"Services — {source.code} [{source.id}]"
        category = db.query(ClaimCategory).filter_by(name=name).first()
        if not category:
            route = db.query(PaymentRoute).filter_by(code="A").first()
            if not route:
                raise HTTPException(422, "The FHI360 Services payment route is not configured.")
            category = ClaimCategory(name=name, form_type="SERVICES", route_id=route.id,
                                     funding_source_id=source.id, payor_org_id=owner.id,
                                     origin_channel="FACILITY", requires_work_log=True)
            db.add(category)
            db.flush()
        category_id = category.id
    category = (db.query(ClaimCategory).filter_by(id=category_id)
                .with_for_update().populate_existing().first())
    if not category or not category.is_active or not category.funding_source_id:
        raise HTTPException(422, "Select a configured Services funding programme.")
    if funding_source_id is not None and funding_source_id != category.funding_source_id:
        raise HTTPException(422, "The selected funding source does not match this Services category.")
    if not db.get(FundingSource, category.funding_source_id):
        raise HTTPException(422, "The Services funding source is no longer available. Ask Central Finance to correct its configuration.")
    if category.origin_channel == "COMMUNITY":
        raise HTTPException(422, "Community claims have a separate workflow. Select a Services work-log programme.")
    is_payroll = (category.form_type or "").upper() in {"SALARY", "PAYROLL", "STIPEND", "STIPENDS", "TIMESHEET"}
    if is_payroll != (log.work_type == "PAYROLL"):
        raise HTTPException(422, "The selected category does not match this Services queue.")
    route, channel = ("A", "FHI360") if log.work_type == "SERVICES" else ("B", "CSO")
    return category, owner, None, route, channel


def _components(db, claim, snapshot):
    for component in snapshot["lines"]:
        db.add(ClaimComponent(
            claim_id=claim.id, component_name=component["activity"], unit_type=component["unit_type"],
            measure_key=component["measure_key"], units=Decimal(component["units"]),
            rate=Decimal(component["rate"]), amount=Decimal(component["amount"]),
        ))


def _guard_daily_service_claim(db, log):
    """Reserve each provider-date once, including across imported overlapping logs."""
    if log.work_type == "SERVICES":
        db.query(Staff).filter_by(id=log.staff_id).with_for_update().one()
        dates = [entry.entry_date for entry, _ in entries_with_measures(db, log.id)]
        duplicate = (db.query(PaymentClaim.id)
                     .join(WorkLog, WorkLog.id == PaymentClaim.work_log_id)
                     .join(WorkLogEntry, WorkLogEntry.work_log_id == WorkLog.id)
                     .filter(PaymentClaim.staff_id == log.staff_id, PaymentClaim.work_type == "SERVICES",
                             PaymentClaim.work_log_id != log.id, PaymentClaim.status != claims.CANCELLED,
                             WorkLogEntry.entry_date.in_(dates)).first())
        if duplicate:
            raise HTTPException(409, "A service payment claim already covers one of these dates. Record all same-day services together; only one daily service amount is payable.")


def prepare_after_rpm(db, current, log):
    """Price verified Services without choosing configuration or committing funds."""
    if log.work_type == "PAYROLL":
        return None
    _guard_daily_service_claim(db, log)
    if db.query(PaymentClaim).filter(
        PaymentClaim.work_log_id == log.id, PaymentClaim.status != claims.CANCELLED,
    ).with_for_update().first():
        raise HTTPException(409, "This work log already has a live claim")
    amount = preview(db, log)
    if amount["exceptions"]:
        # RM approves the work, not missing financial terms. Services can
        # reach Regional Finance without inventing a zero-value claim.
        # Finance still cannot prepare, route or pay until all pricing is valid.
        return None
    snapshot = jsonable_encoder({
        **amount, "operationally_approved_by": current.id,
        "operationally_approved_at": utcnow(),
    })
    claim = PaymentClaim(
        workflow_version=log.workflow_version, work_type=log.work_type,
        work_log_id=log.id, staff_id=log.staff_id, period_id=log.period_id,
        assignment_id=log.assignment_id, amount=Decimal(amount["total"]),
        currency=amount["currency"], calculation_snapshot=snapshot,
        created_by=current.id, status=claims.PENDING_FINANCE_REVIEW,
    )
    db.add(claim)
    db.flush()
    _components(db, claim, snapshot)
    claims.audit(db, current, claim, "rpm_prepare", RPM, None, claim.payment_status,
                 details={"work_log_id": log.id, "amount": str(claim.amount), "budget_committed": False})
    return claim


def review(db, current, log, category_id, funding_source_id=None):
    if log.work_type == "PAYROLL":
        raise HTTPException(409, "Payroll is an approved work report; finance approval, pricing and budgets are not required.")
    if not category_id and not funding_source_id:
        raise HTTPException(422, "Select the funding programme for Services finance review.")
    _guard_daily_service_claim(db, log)
    pending = db.query(PaymentClaim).filter(
        PaymentClaim.work_log_id == log.id, PaymentClaim.status != claims.CANCELLED,
    ).with_for_update().first()
    previous_status = pending.status if pending else None
    # Old proposals can have partial/missing calculations. preview validates
    # the frozen shape before falling back to the saved clinical/rate terms.
    amount = preview(db, log)
    if amount["exceptions"]:
        missing_rates = any("no configured" in error for error in amount["exceptions"])
        if missing_rates:
            raise HTTPException(422, "Payment setup is incomplete: approved amounts/rates are missing for recorded work dates. Configure the missing amounts listed in Payment estimate before Finance prepares the claim.")
        raise HTTPException(422, " ".join(amount["exceptions"]))
    category, owner, line, route, channel = _context(db, log, category_id, funding_source_id)
    log.finance_snapshot = jsonable_encoder({
        **amount, "category_id": category.id, "payor_org_id": owner.id,
        "executor_org_id": owner.id, "budget_line_id": None, "route_code": route,
        "channel": channel, "reviewed_by": current.id,
        "funding_source_id": category.funding_source_id,
        "funding_source_name": db.get(FundingSource, category.funding_source_id).name,
        "review_token": uuid4().hex,
        "payment_policy": "FIXED_DAILY_NO_BUDGET",
    })
    claim = _prepare_claim(db, current, log, category, owner, line, route)
    claims.audit(db, current, claim, "finance_prepare", REGIONAL_FINANCE,
                 previous_status, claim.payment_status,
                 details={"work_log_id": log.id, "amount": str(claim.amount),
                          "funding_source_id": category.funding_source_id,
                          "awaiting_explicit_payor": True})


def _prepare_claim(db, current, log, category, owner, line, route_code):
    snapshot = log.finance_snapshot
    claim = db.query(PaymentClaim).filter(PaymentClaim.work_log_id == log.id, PaymentClaim.status != claims.CANCELLED).with_for_update().first()
    if claim:
        if claim.status not in {claims.PENDING_FINANCE_REVIEW, claims.PENDING_ROUTING, claims.HELD}:
            raise HTTPException(409, "This work log already has a routed claim")
        if claim.status in {claims.PENDING_FINANCE_REVIEW, claims.PENDING_ROUTING, claims.HELD}:
            if db.query(BudgetTransaction.id).filter(BudgetTransaction.claim_id == claim.id).first():
                raise HTTPException(409, "This claim has financial ledger history and cannot be reconfigured as an uncommitted proposal.")
            duplicate = db.query(PaymentClaim).filter(
                PaymentClaim.id != claim.id, PaymentClaim.staff_id == log.staff_id,
                PaymentClaim.period_id == log.period_id, PaymentClaim.category_id == category.id,
                PaymentClaim.status != claims.CANCELLED,
            ).first()
            if duplicate:
                raise HTTPException(409, "A live claim already exists for this provider, category and period")
            claim.category_id = category.id
            claim.route_code = route_code
            claim.payor_org_id = owner.id
            claim.executor_org_id = owner.id
            claim.funding_source_id = category.funding_source_id
            claim.budget_line_id = None
            claim.origin_channel = category.origin_channel
            claim.calculation_snapshot = snapshot
            claim.amount = Decimal(snapshot["total"])
            claim.currency = snapshot["currency"]
            claim.status = claims.PENDING_ROUTING
        return claim
    duplicate = db.query(PaymentClaim).filter(
        PaymentClaim.staff_id == log.staff_id, PaymentClaim.period_id == log.period_id,
        PaymentClaim.category_id == category.id, PaymentClaim.status != claims.CANCELLED,
    ).first()
    if duplicate:
        raise HTTPException(409, "A live claim already exists for this provider, category and period")
    claim = PaymentClaim(
        workflow_version=2, work_type=log.work_type, work_log_id=log.id, staff_id=log.staff_id,
        period_id=log.period_id, assignment_id=log.assignment_id, category_id=category.id,
        route_code=route_code, payor_org_id=owner.id, executor_org_id=owner.id,
        funding_source_id=category.funding_source_id, budget_line_id=None,
        origin_channel=category.origin_channel, amount=Decimal(snapshot["total"]),
        currency=snapshot["currency"], calculation_snapshot=snapshot, created_by=current.id,
        status=claims.PENDING_ROUTING,
    )
    db.add(claim)
    db.flush()
    _components(db, claim, snapshot)
    return claim


def cancel_pending(db, current, log, comment):
    """Returning a reviewed log retires its unpaid proposal, retaining its audit history."""
    pending = db.query(PaymentClaim).filter(PaymentClaim.work_log_id == log.id, PaymentClaim.status != claims.CANCELLED).with_for_update().all()
    if any(claim.status not in {claims.PENDING_FINANCE_REVIEW, claims.PENDING_ROUTING} for claim in pending):
        raise HTTPException(409, "Cancel any routed claims before returning this work log")
    for claim in pending:
        old = claim.status
        claim.status = claims.CANCELLED
        claims.audit(db, current, claim, "finance_return", REGIONAL_FINANCE, old, claim.payment_status, comment)


def route(db, current, log, channel, target_payor_id=None, expected_review_token=None):
    if log.work_type == "PAYROLL":
        raise HTTPException(409, "Payroll is report-only and cannot be routed as a payment claim.")
    snapshot = log.finance_snapshot
    expected = "FHI360" if log.work_type == "SERVICES" else "CSO"
    if channel != expected:
        raise HTTPException(422, f"{log.work_type} must be routed to {expected}")
    if not snapshot:
        raise HTTPException(409, "Regional Finance must review the amount before routing")
    if expected_review_token is not None and expected_review_token != snapshot.get("review_token"):
        raise HTTPException(409, "Another Finance review changed this payment setup. Refresh and verify the current funding source and category before routing.")
    if snapshot.get("payment_policy") != "FIXED_DAILY_NO_BUDGET":
        raise HTTPException(409, "Review the Services amount again to use fixed daily payments without a budget.")
    if target_payor_id is None:
        raise HTTPException(422, "Select the destination payor explicitly before channeling")
    if target_payor_id not in {owner.id for owner in eligible_payors(db, log, lock=True)}:
        raise HTTPException(422, f"The selected payor is not eligible: {log.work_type} must go to its assigned {expected} payor")
    # Claim before budget-line locks: payment/cancellation paths use this order.
    existing = (db.query(PaymentClaim).filter(PaymentClaim.work_log_id == log.id,
                                             PaymentClaim.status != claims.CANCELLED)
                .with_for_update().populate_existing().first())
    category, owner, line, route_code, _ = _context(db, log, snapshot["category_id"])
    if owner.id != snapshot["payor_org_id"]:
        raise HTTPException(409, "The payment organization changed. Review the Services amount again before routing.")
    source_id = snapshot.get("funding_source_id")
    if source_id is None:
        source_id = existing.funding_source_id if existing else None
    if source_id != category.funding_source_id:
        raise HTTPException(409, "Funding source changed after review. Review the Services payment setup again before routing.")
    claim = _prepare_claim(db, current, log, category, owner, line, route_code)
    old = claim.status
    details = {"payment_policy": "FIXED_DAILY_NO_BUDGET", "budget_required": False}
    details.update(target_payor_id=owner.id, target_payor_name=owner.name, actor_id=current.id,
                   channeled_at=utcnow().isoformat(), claim_id=claim.id)
    claim.status = claims.READY
    claim.approved_by = current.id
    claim.approved_at = utcnow()
    log.routed_channel = channel
    log.status = f"ROUTED_{channel}"
    claims.audit(db, current, claim, "finance_route", REGIONAL_FINANCE, old, claim.payment_status, details=details)
    return details
