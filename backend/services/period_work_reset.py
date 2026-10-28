"""Explicit October restart: clear active work, never erase audit or budget history."""
import hashlib
import json
from datetime import date

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy import or_

from ..core import audit
from ..core.roles import SUPER_ADMIN
from ..models import (
    BudgetLine, OTPChallenge, PaymentClaim, PayPeriod, SMSOutbox, WorkLog,
    WorkLogAudit, WorkLogEntry, WorkLogMeasure, WorkLogVersion, utcnow,
)
from .forms import build_snapshot

CONFIRMATION = "CLEAR OCTOBER 2026"


def _rows(query, lock):
    return query.populate_existing().with_for_update().all() if lock else query.all()


def inspect_reset(db, period_id, *, lock=False):
    periods = _rows(db.query(PayPeriod).filter_by(id=period_id), lock)
    if not periods:
        raise HTTPException(404, "Pay period not found")
    period = periods[0]
    if (period.start_date, period.end_date, period.region_id) != (date(2026, 10, 1), date(2026, 10, 31), None):
        raise HTTPException(422, "This restart is limited to the global October 2026 period.")
    logs = _rows(db.query(WorkLog).filter_by(period_id=period.id).order_by(WorkLog.id), lock)
    ids = [log.id for log in logs]
    entries = _rows(db.query(WorkLogEntry).filter(WorkLogEntry.work_log_id.in_(ids)).order_by(WorkLogEntry.id), lock)
    entry_ids = [entry.id for entry in entries]
    measures = _rows(db.query(WorkLogMeasure).filter(WorkLogMeasure.entry_id.in_(entry_ids)).order_by(WorkLogMeasure.id), lock)
    budgets = _rows(db.query(BudgetLine).filter_by(period_id=period.id).order_by(BudgetLine.id), lock)
    claims = db.query(PaymentClaim.id).filter(or_(
        PaymentClaim.period_id == period.id, PaymentClaim.work_log_id.in_(ids),
    )).order_by(PaymentClaim.id).all()
    blockers = []
    if claims:
        blockers.append("Payment claims now exist. No work records can be cleared.")
    if any(line.committed_amount or line.spent_amount for line in budgets):
        blockers.append("Budget funds have been committed or spent. No work records can be cleared.")
    if period.status != "OPEN":
        blockers.append("Reopen October's pay period before clearing work records.")
    entries_by_log = {entry.work_log_id for entry in entries}
    affected = [log for log in logs if log.id in entries_by_log or log.status != "DRAFT"
                or log.submitted_at or log.approved_at or log.attested_at
                or log.period_comment or log.finance_snapshot or log.routed_channel]
    counts = {
        "work_logs": len(logs), "work_logs_to_reset": len(affected),
        "daily_entries": len(entries), "indicator_values": len(measures),
        "budget_lines_preserved": len(budgets), "claims": len(claims),
    }
    # No sensitive content is returned; the digest detects edits after review.
    fingerprint_data = {
        "period": [period.id, period.start_date, period.end_date, period.status, period.region_id],
        "logs": [[row.id, row.status, row.version, row.updated_at] for row in logs],
        "entries": [[row.id, row.updated_at] for row in entries],
        "measures": [[row.id, row.field_key, row.value] for row in measures],
        "budgets": [[row.id, row.updated_at, row.allocated_amount, row.committed_amount, row.spent_amount] for row in budgets],
        "claims": [row.id for row in claims],
    }
    token = hashlib.sha256(json.dumps(jsonable_encoder(fingerprint_data), sort_keys=True).encode()).hexdigest()
    preview = {
        "period_id": period.id, "period_label": period.period_label,
        "start_date": period.start_date, "end_date": period.end_date,
        "counts": counts, "blockers": blockers, "preview_token": token,
        "confirmation": CONFIRMATION, "can_reset": not blockers and bool(affected),
    }
    return preview, affected, entries


def clear_work(db, current, period_id, *, confirmation, preview_token, reason):
    if SUPER_ADMIN not in current.roles:
        raise HTTPException(403, "Only Super Admin can clear October work records.")
    if confirmation != CONFIRMATION:
        raise HTTPException(422, f"Type {CONFIRMATION} exactly to confirm.")
    if len(reason.strip()) < 10:
        raise HTTPException(422, "Give a reason of at least 10 characters.")
    preview, logs, entries = inspect_reset(db, period_id, lock=True)
    if preview["blockers"]:
        raise HTTPException(409, " ".join(preview["blockers"]))
    if preview_token != preview["preview_token"]:
        raise HTTPException(409, "October records changed since your review. Reload the reset preview and confirm again.")
    if not preview["can_reset"]:
        raise HTTPException(409, "October work records are already empty.")
    ids = [log.id for log in logs]
    # Lock queued notices before changing state; never send an SMS for a reset.
    pending = _rows(db.query(SMSOutbox).filter(
        SMSOutbox.related_type == "work_log", SMSOutbox.related_id.in_(ids),
        SMSOutbox.status == "PENDING",
    ).order_by(SMSOutbox.id), True)
    now = utcnow()
    for log in logs:
        before_status = log.status
        existing_versions = [v for (v,) in db.query(WorkLogVersion.version).filter_by(work_log_id=log.id)]
        backup_version = max([log.version, *existing_versions]) + 1
        snapshot = build_snapshot(db, log)
        snapshot.update(version=backup_version, captured_before_reset=True, status=before_status)
        db.add(WorkLogVersion(work_log_id=log.id, version=backup_version,
                              snapshot=snapshot, created_by=current.id))
        log.status = "DRAFT"
        log.version = backup_version + 1
        log.confirmed_version = None
        log.period_comment = None
        log.attested_at = log.submitted_at = log.approved_at = None
        log.submit_gps_lat = log.submit_gps_lon = log.submit_gps_accuracy_m = None
        log.finance_snapshot = log.routed_channel = None
        log.status_changed_at = now
        db.add(WorkLogAudit(
            work_log_id=log.id, version=log.version, actor_id=current.id,
            actor_role=SUPER_ADMIN, action="reset_work_records", old_status=before_status,
            new_status="DRAFT", comment=reason.strip(),
            details={"preserved_backup_version": backup_version, "period_id": period_id},
        ))
    entry_ids = [entry.id for entry in entries]
    db.query(WorkLogMeasure).filter(WorkLogMeasure.entry_id.in_(entry_ids)).delete(synchronize_session=False)
    db.query(WorkLogEntry).filter(WorkLogEntry.id.in_(entry_ids)).delete(synchronize_session=False)
    db.query(OTPChallenge).filter(OTPChallenge.work_log_id.in_(ids)).update(
        {OTPChallenge.is_used: True}, synchronize_session=False)
    for row in pending:
        row.status = "SUPPRESSED"
        row.last_error = "October work records cleared by Super Admin"
    audit.record(
        db, current, "pay-periods", period_id, "clear_work_records",
        before=preview["counts"],
        after={"status": "DRAFT", "daily_entries": 0, "budget_and_audit_preserved": True},
        reason=reason.strip(),
    )
    return {"cleared": True, "period_id": period_id, "counts": preview["counts"],
            "message": "October work logs are empty drafts. The period, budget and historical audit snapshots are unchanged."}
