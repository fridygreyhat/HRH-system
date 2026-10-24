"""Background worker: delivers the SMS outbox and runs the hourly 48-hour reminder check.

Run: python -m backend.worker            (loop)
     python -m backend.worker --once     (one pass of each job; used by tests)
"""
import argparse
import logging
import time
from datetime import timedelta

from sqlalchemy.orm import Session

from .core.settings import get_setting
from .db.session import SessionLocal
from .models import PaymentClaim, PayPeriod, SMSOutbox, Staff, StaffAssignment, WorkLog, utcnow
from .services import notifications
from .services.scope import users_in_scope_for
from .services.sms_gateway import get_sms_gateway
from .services.worklog_workflow import STAGE_OWNER, period_label

logger = logging.getLogger("hrh.worker")
OUTBOX_INTERVAL_SECONDS = 15
REMINDER_INTERVAL_SECONDS = 3600


def _is_stale(db: Session, row: SMSOutbox) -> bool:
    """Suppress messages whose triggering state no longer holds (status change, resolution, cancellation)."""
    if row.related_type == "work_log":
        log = db.get(WorkLog, row.related_id)
        return log is None or log.status != row.related_status
    if row.related_type == "claim_payment":
        claim = db.get(PaymentClaim, row.related_id)
        return claim is None or claim.payment_status not in ("PAID", "RECONCILED")
    if row.related_type == "claim":
        claim = db.get(PaymentClaim, row.related_id)
        return claim is None or claim.status != row.related_status
    return False


def process_outbox(db: Session, limit: int = 50) -> int:
    rows = (
        db.query(SMSOutbox)
        .filter(SMSOutbox.status == "PENDING", SMSOutbox.next_attempt_at <= utcnow())
        .order_by(SMSOutbox.id)
        .with_for_update(skip_locked=True)
        .limit(limit)
        .all()
    )
    gateway = get_sms_gateway()
    max_attempts = get_setting(db, "sms_max_attempts")
    for row in rows:
        if _is_stale(db, row):
            row.status = "SUPPRESSED"
            row.last_error = "State changed before delivery"
            continue
        row.attempts += 1
        try:
            message_id = gateway.send_sms(row.destination_phone, row.message_body)
        except Exception as e:  # gateway failures never touch workflow state
            message_id, row.last_error = None, str(e)[:500]
        if message_id:
            row.status, row.provider_message_id, row.sent_at, row.last_error = "SENT", message_id, utcnow(), None
        elif row.attempts >= max_attempts:
            row.status = "FAILED"
            row.last_error = row.last_error or "Gateway rejected the message"
        else:
            row.next_attempt_at = utcnow() + timedelta(minutes=2**row.attempts)
            row.last_error = row.last_error or "Gateway rejected the message; will retry"
    db.commit()
    return len(rows)


def run_reminders(db: Session) -> int:
    """Remind the currently assigned reviewer about logs pending > N hours, at most once per M hours each."""
    after = get_setting(db, "reminder_after_hours")
    repeat = get_setting(db, "reminder_repeat_hours")
    now = utcnow()
    sent = 0
    logs = db.query(WorkLog).filter(WorkLog.status.in_(STAGE_OWNER), WorkLog.status_changed_at <= now - timedelta(hours=after)).all()
    for log in logs:
        assignment = db.get(StaffAssignment, log.assignment_id)
        staff = db.get(Staff, log.staff_id)
        for user in users_in_scope_for(db, STAGE_OWNER[log.status], assignment):
            if user.id == staff.user_id:
                continue
            recent = (
                db.query(SMSOutbox)
                .filter(
                    SMSOutbox.event_name == "WORKLOG_REMINDER",
                    SMSOutbox.related_id == log.id,
                    SMSOutbox.related_status == log.status,
                    SMSOutbox.user_id == user.id,
                    SMSOutbox.created_at >= log.status_changed_at,
                    SMSOutbox.created_at > now - timedelta(hours=repeat),
                )
                .count()
            )
            if recent:
                continue
            notifications.enqueue(
                db,
                "WORKLOG_REMINDER",
                user,
                None,
                related=("work_log", log.id, log.status),
                provider=staff.legal_name,
                period=period_label(db.get(PayPeriod, log.period_id)),
                hours=after,
            )
            sent += 1
    db.commit()
    return sent


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

    last_reminder = 0.0
    while True:
        with SessionLocal() as db:
            try:
                if time.monotonic() - last_reminder >= REMINDER_INTERVAL_SECONDS or args.once:
                    queued = run_reminders(db)
                    last_reminder = time.monotonic()
                    logger.info("Reminder check queued %s reminder(s)", queued)
                processed = process_outbox(db)
                if processed:
                    logger.info("Processed %s outbox message(s)", processed)
            except Exception:
                db.rollback()
                logger.exception("Worker pass failed")
        if args.once:
            return
        time.sleep(OUTBOX_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
