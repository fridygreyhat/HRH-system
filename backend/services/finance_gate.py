"""The v2 regional finance gate: snapshot → validate amount → route → payable claim."""
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder

from ..core.roles import REGIONAL_FINANCE
from ..models import ClaimCategory, ClaimComponent, Organization, PaymentClaim, PayPeriod, StaffAssignment
from . import budgets, claims
from .forms import entries_with_measures


def preview(db, log) -> dict:
    lines, exceptions, currencies = [], [], set()
    total = Decimal(0)
    for entry, measures in entries_with_measures(db, log.id):
        activity = entry.activity_snapshot or {}
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
            "activity_key": entry.activity_key, "activity_rate_id": activity.get("id"),
            "unit_type": unit_type, "measure_key": activity.get("billable_field"),
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


def _context(db, log, category_id):
    category = db.get(ClaimCategory, category_id)
    if not category or not category.is_active or not category.funding_source_id:
        raise HTTPException(422, "Select an active claim category with a configured funding source")
    is_payroll = (category.form_type or "").upper() in {"SALARY", "PAYROLL", "STIPEND", "STIPENDS", "TIMESHEET"}
    if is_payroll != (log.work_type == "PAYROLL"):
        raise HTTPException(422, "The selected budget category does not match this Services or Payroll queue")
    assignment = db.get(StaffAssignment, log.assignment_id)
    if log.work_type == "SERVICES":
        owners = db.query(Organization).filter(Organization.type == "FHI360").all()
        if len(owners) != 1:
            raise HTTPException(422, "Exactly one FHI360 payor organization must be configured")
        owner, route, channel = owners[0], "A", "FHI360"
    else:
        owner = db.get(Organization, assignment.organization_id) if assignment.organization_id else None
        if not owner or owner.type != "CSO":
            raise HTTPException(422, "Payroll needs the provider's assigned CSO; it cannot be routed to FHI360")
        route, channel = "B", "CSO"
    line = budgets.find_line(db, category.id, log.period_id, owner.id, assignment.region_id)
    if not line:
        raise HTTPException(422, f"No {channel}-owned budget line matches this category, period and region")
    return category, owner, line, route, channel


def review(db, current, log, category_id):
    if not category_id:
        raise HTTPException(422, "Select the budget category for finance review")
    amount = preview(db, log)
    if amount["exceptions"]:
        raise HTTPException(422, " ".join(amount["exceptions"]))
    category, owner, line, route, channel = _context(db, log, category_id)
    if line.currency != amount["currency"]:
        raise HTTPException(422, "Activity-rate currency does not match the budget line")
    log.finance_snapshot = jsonable_encoder({
        **amount, "category_id": category.id, "payor_org_id": owner.id,
        "executor_org_id": owner.id, "budget_line_id": line.id, "route_code": route,
        "channel": channel, "reviewed_by": current.id,
    })


def route(db, current, log, channel):
    snapshot = log.finance_snapshot
    expected = "FHI360" if log.work_type == "SERVICES" else "CSO"
    if channel != expected:
        raise HTTPException(422, f"{log.work_type} must be routed to {expected}")
    if not snapshot:
        raise HTTPException(409, "Regional Finance must review the amount before routing")
    category, owner, line, route_code, _ = _context(db, log, snapshot["category_id"])
    if owner.id != snapshot["payor_org_id"] or line.id != snapshot["budget_line_id"]:
        raise HTTPException(409, "Finance configuration changed; return the log for a fresh finance review")
    claim = db.query(PaymentClaim).filter(PaymentClaim.work_log_id == log.id, PaymentClaim.status != claims.CANCELLED).with_for_update().first()
    if claim and claim.status != claims.HELD:
        raise HTTPException(409, "This work log already has a routed claim")
    if not claim:
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
            funding_source_id=category.funding_source_id, budget_line_id=line.id,
            origin_channel=category.origin_channel, amount=Decimal(snapshot["total"]),
            currency=snapshot["currency"], calculation_snapshot=snapshot, created_by=current.id,
            approved_by=current.id,
        )
        db.add(claim)
        db.flush()
        for component in snapshot["lines"]:
            db.add(ClaimComponent(
                claim_id=claim.id, component_name=component["activity"], unit_type=component["unit_type"],
                measure_key=component["measure_key"], units=Decimal(component["units"]),
                rate=Decimal(component["rate"]), amount=Decimal(component["amount"]),
            ))
    old = claim.status
    details = claims._commit_budget(db, current, claim)
    if claim.status == claims.APPROVED:
        claim.status = claims.READY
        log.routed_channel = channel
        log.status = f"ROUTED_{channel}"
    else:
        log.status = "BUDGET_HOLD"
    claims.audit(db, current, claim, "finance_route", REGIONAL_FINANCE, old, claim.payment_status, details=details)
    return details
