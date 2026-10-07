"""Claim lineage: from a payment back to the exact daily work and approvals that produced it.

Claim → component → approved rate rule → the daily entries (and measure values) that supplied its units →
evidence and location → the work-log version the provider confirmed → every approval and payment step.
Each component reports whether its traced daily values add up to the units that were paid, and whether
they match the frozen version the provider confirmed by SMS code.
"""
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from ..core.roles import CSO_FINANCE, FHI360_FINANCE
from ..core.security import CurrentUser
from ..core.serialize import to_dict
from ..models import (
    BudgetLine,
    Cadre,
    ClaimAudit,
    ClaimCategory,
    ClaimComponent,
    PaymentClaim,
    PaymentProof,
    PaymentRecord,
    PayPeriod,
    RateRule,
    Staff,
    User,
    WorkLog,
    WorkLogAudit,
    WorkLogVersion,
)
from .forms import cadre_fields, entries_with_measures
from .scope import can_see_gps
from .worklog_workflow import period_label

# Work-log decisions that make up the verification chain (opened/edit events are left out).
DECISIONS = {"submit", "verify", "confirm_otp", "facility_endorse", "endorse", "authorize", "return", "return_to_reviewer",
             "reject", "hold", "release", "reopen", "decline"}


def _names(db: Session, ids) -> dict[int, str]:
    ids = {i for i in ids if i}
    return {u.id: u.full_name for u in db.query(User).filter(User.id.in_(ids))} if ids else {}


def _snapshot_units(snapshot: dict, unit_type: str, measure_key: Optional[str]) -> Optional[Decimal]:
    totals = snapshot.get("totals", {})
    if unit_type == "PER_DAY":
        return Decimal(str(totals.get("days", 0)))
    if unit_type == "PER_HOUR":
        return Decimal(str(totals.get("hours", 0)))
    if unit_type == "PER_UNIT":
        return Decimal(str(totals.get("measures", {}).get(measure_key, 0)))
    return None


def trace_claim(db: Session, current: CurrentUser, claim: PaymentClaim) -> dict:
    staff = db.get(Staff, claim.staff_id)
    log = db.get(WorkLog, claim.work_log_id) if claim.work_log_id else None
    show_gps = can_see_gps(db, current, claim.staff_id, claim.assignment_id)
    labels = {f.key: f for f in cadre_fields(db, staff.cadre_id, include_inactive=True)}

    entries = entries_with_measures(db, log.id) if log else []
    confirmed = (
        db.query(WorkLogVersion).filter(WorkLogVersion.work_log_id == log.id, WorkLogVersion.version == log.confirmed_version).first()
        if log and log.confirmed_version
        else None
    )
    rules = {r.id: r for r in db.query(RateRule).filter(RateRule.id.in_([c.rate_rule_id for c in db.query(ClaimComponent.rate_rule_id).filter(ClaimComponent.claim_id == claim.id)]))}
    names = _names(db, [r.approved_by for r in rules.values()] + [r.created_by for r in rules.values()])

    components = []
    for comp in db.query(ClaimComponent).filter(ClaimComponent.claim_id == claim.id).order_by(ClaimComponent.id):
        rule = rules.get(comp.rate_rule_id)
        field = labels.get(comp.measure_key) if comp.measure_key else None
        contributions = []
        if log and comp.unit_type in ("PER_DAY", "PER_HOUR", "PER_UNIT"):
            for entry, measures in entries:
                value = {"PER_DAY": Decimal(1), "PER_HOUR": entry.hours_worked}.get(comp.unit_type, measures.get(comp.measure_key, Decimal(0)))
                if not value:
                    continue
                row = {
                    "entry_id": entry.id,
                    "date": entry.entry_date,
                    "value": value,
                    "hours_worked": entry.hours_worked,
                    "evidence_text": entry.evidence_text,
                    "comment": entry.comment,
                    "location_status": entry.location_status,
                }
                if show_gps:
                    row.update({"gps_lat": entry.gps_lat, "gps_lon": entry.gps_lon})
                contributions.append(row)
        traced_total = sum((c["value"] for c in contributions), Decimal(0))
        snapshot_units = _snapshot_units(confirmed.snapshot, comp.unit_type, comp.measure_key) if confirmed and comp.unit_type != "FIXED" else None

        if comp.unit_type == "FIXED":
            basis = "Fixed amount per claim; not tied to individual days"
            reconciles = True
        elif not log:
            basis = "Declared units on a claim without an HRH work log (checked by the community verifier)"
            reconciles = None
        else:
            basis = {
                "PER_DAY": "One unit for each day with a work-log entry",
                "PER_HOUR": "Hours worked across the work log",
                "PER_UNIT": f"Sum of '{field.label_en if field else comp.measure_key}' across the work log",
            }[comp.unit_type]
            reconciles = traced_total == comp.units

        components.append({
            **to_dict(comp),
            "measure_label_en": field.label_en if field else None,
            "measure_label_sw": field.label_sw if field else None,
            "basis": basis,
            "rate_rule": {
                **to_dict(rule, exclude=("created_at",)),
                "created_by_name": names.get(rule.created_by),
                "approved_by_name": names.get(rule.approved_by),
            } if rule else None,
            "contributions": contributions,
            "traced_total": traced_total if log else None,
            "reconciles": reconciles,
            "confirmed_version_units": snapshot_units,
            "matches_confirmed_version": None if snapshot_units is None else snapshot_units == comp.units,
        })

    log_chain = []
    if log:
        rows = db.query(WorkLogAudit).filter(WorkLogAudit.work_log_id == log.id, WorkLogAudit.action.in_(DECISIONS)).order_by(WorkLogAudit.timestamp, WorkLogAudit.id).all()
        actors = _names(db, [r.actor_id for r in rows])
        log_chain = [{**to_dict(r, exclude=("details",)), "actor_name": actors.get(r.actor_id)} for r in rows]
    claim_rows = db.query(ClaimAudit).filter(ClaimAudit.claim_id == claim.id).order_by(ClaimAudit.timestamp, ClaimAudit.id).all()
    actors = _names(db, [r.actor_id for r in claim_rows] + [claim.verified_by])

    finance = current.has_any(FHI360_FINANCE, CSO_FINANCE)
    payments = db.query(PaymentRecord).filter(PaymentRecord.claim_id == claim.id).order_by(PaymentRecord.id).all()
    line = db.get(BudgetLine, claim.budget_line_id) if claim.budget_line_id else None
    checks = [c["reconciles"] for c in components if c["reconciles"] is not None]
    confirmed_checks = [c["matches_confirmed_version"] for c in components if c["matches_confirmed_version"] is not None]

    return {
        "claim": {
            "id": claim.id,
            "amount": claim.amount,
            "currency": claim.currency,
            "status": claim.status,
            "payment_status": claim.payment_status,
            "route_code": claim.route_code,
            "category": db.get(ClaimCategory, claim.category_id).name,
            "staff_name": staff.legal_name,
            "cadre": db.get(Cadre, staff.cadre_id).code,
            "period": period_label(db.get(PayPeriod, claim.period_id)),
            "budget_line": line.code if line else None,
            "approved_at": claim.approved_at,
            "authorized_calculation": claim.calculation_snapshot,
        },
        "basis": "WORK_LOG" if log else "DECLARED_UNITS",
        "work_log": {
            "id": log.id,
            "status": log.status,
            "version": log.version,
            "confirmed_version": log.confirmed_version,
            "confirmed_at": confirmed.created_at if confirmed else None,
            "attested_at": log.attested_at,
            "approved_at": log.approved_at,
            "days": len(entries),
        } if log else None,
        "declared_units": claim.declared_units,
        "evidence_text": claim.evidence_text,
        "community_verification": {"verified_by": actors.get(claim.verified_by), "verified_at": claim.verified_at} if claim.verified_at else None,
        "components": components,
        "summary": {
            "components": len(components),
            "all_reconcile": all(checks) if checks else None,
            "all_match_confirmed_version": all(confirmed_checks) if confirmed_checks else None,
            "components_total": sum((c.amount for c in db.query(ClaimComponent).filter(ClaimComponent.claim_id == claim.id)), Decimal(0)),
            "location_exceptions": sorted({c["date"].isoformat() for comp in components for c in comp["contributions"] if c["location_status"] in ("NO_GPS", "OUTSIDE_GEOFENCE", "NO_GEOFENCE")}),
            "gps_visible": show_gps,
        },
        "work_log_chain": log_chain,
        "claim_chain": [{**to_dict(r, exclude=("details",)), "actor_name": actors.get(r.actor_id)} for r in claim_rows],
        "payments": [to_dict(p) for p in payments] if finance else [],
        "proof_count": db.query(PaymentProof).filter(PaymentProof.claim_id == claim.id).count() if finance else None,
    }
