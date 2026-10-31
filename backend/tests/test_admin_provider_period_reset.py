"""Super Admin can restart one provider's period without deleting its history."""
from datetime import date, timedelta

import pytest

from backend.models import (
    AuditEvent,
    ClaimCategory,
    PayPeriod,
    PaymentClaim,
    User,
    WorkLog,
    WorkLogAudit,
    WorkLogEntry,
    WorkLogMeasure,
    WorkLogVersion,
)
from .conftest import draft_log


def test_super_admin_resets_all_provider_work_types_and_keeps_history(api, db, period):
    services = draft_log(api, "hcp1", period)
    services_row = db.get(WorkLog, services["id"])
    services_row.status = "PENDING_TECHNICAL_REVIEW"
    services_row.confirmed_version = services_row.version
    services_row.attested_at = services_row.created_at
    payroll_row = WorkLog(
        staff_id=services_row.staff_id,
        period_id=services_row.period_id,
        assignment_id=services_row.assignment_id,
        cadre_id=services_row.cadre_id,
        workflow_version=2,
        work_type="PAYROLL",
        status="APPROVED",
    )
    services_row.workflow_version = 2
    services_row.work_type = "SERVICES"
    db.add(payroll_row)
    db.flush()
    payroll_row.approved_at = payroll_row.created_at
    entry = WorkLogEntry(
        work_log_id=payroll_row.id,
        entry_date=date.fromisoformat(period["start_date"]) + timedelta(days=2),
        hours_worked=8,
        evidence_text="Payroll demo entry",
    )
    db.add(entry)
    db.flush()
    payroll_entry_id = entry.id
    db.add(WorkLogMeasure(entry_id=entry.id, field_key="hours", value=8))
    admin = db.query(User).filter_by(username="admin").one()
    db.add(WorkLogVersion(work_log_id=services_row.id, version=1, snapshot={"historical": True}, created_by=admin.id))
    db.commit()
    original_audits = db.query(WorkLogAudit).filter_by(work_log_id=services_row.id).count()

    for actor in ("tofficer1", "hcp1"):
        api.get(f"/admin/pay-periods/{period['id']}/provider-records", actor, expect=403)

    overview = api.get(f"/admin/pay-periods/{period['id']}/provider-records", "admin")
    provider = next(row for row in overview["providers"] if row["username"] == "hcp1")
    assert provider["can_reset"] is True
    assert {row["work_type"] for row in provider["work_logs"]} == {"SERVICES", "PAYROLL"}
    assert sum(row["entry_count"] for row in provider["work_logs"]) == 3

    path = f"/admin/pay-periods/{period['id']}/providers/{services_row.staff_id}/reset-records"
    body = {"reason": "Clear testing records for a fresh entry", "confirmation": "RESET hcp1"}
    api.post(path, "admin", body, expect=422)
    api.post(path, "tofficer1", {**body, "confirmation": f"RESET hcp1 {period['id']}"}, expect=403)
    result = api.post(path, "admin", {**body, "confirmation": f"RESET hcp1 {period['id']}"})
    assert result == {
        "reset": True,
        "staff_id": services_row.staff_id,
        "period_id": period["id"],
        "work_logs_reset": 2,
        "entries_cleared": 3,
    }

    db.expire_all()
    assert db.query(WorkLogEntry).filter(WorkLogEntry.work_log_id.in_([services_row.id, payroll_row.id])).count() == 0
    assert db.query(WorkLogMeasure).filter(WorkLogMeasure.entry_id == payroll_entry_id).count() == 0
    assert db.get(WorkLog, services_row.id).status == "DRAFT"
    assert db.get(WorkLog, payroll_row.id).status == "DRAFT"
    assert db.get(WorkLog, services_row.id).confirmed_version is None
    assert db.get(WorkLog, services_row.id).attested_at is None
    assert db.get(WorkLog, payroll_row.id).approved_at is None
    assert db.query(WorkLogVersion).filter_by(work_log_id=services_row.id).count() == 1
    assert db.query(WorkLogAudit).filter_by(work_log_id=services_row.id).count() == original_audits + 1
    assert db.query(WorkLogAudit).filter_by(work_log_id=services_row.id, action="admin_reset").count() == 1
    assert db.get(PayPeriod, period["id"]) is not None
    assert db.query(AuditEvent).filter_by(
        entity_type="provider-period-records",
        entity_id=f"{services_row.staff_id}:{period['id']}",
        action="reset",
    ).count() == 1


@pytest.mark.parametrize("protection", ["paid", "claim"])
def test_provider_period_reset_protects_paid_or_claimed_work(api, db, period, protection):
    log_data = draft_log(api, "hcp1", period)
    log = db.get(WorkLog, log_data["id"])
    log.status = "PAID" if protection == "paid" else "APPROVED"
    if protection == "claim":
        claim = PaymentClaim(
            staff_id=log.staff_id,
            work_log_id=log.id,
            period_id=period["id"],
            category_id=db.query(ClaimCategory).first().id,
            created_by=db.query(User).filter_by(username="admin").one().id,
        )
        db.add(claim)
    db.commit()

    api.post(
        f"/admin/pay-periods/{period['id']}/providers/{log.staff_id}/reset-records",
        "admin",
        {"reason": "Restart testing", "confirmation": f"RESET hcp1 {period['id']}"},
        expect=409,
    )
    db.expire_all()
    assert db.get(WorkLog, log.id).status == ("PAID" if protection == "paid" else "APPROVED")
    assert db.query(WorkLogEntry).filter_by(work_log_id=log.id).count() == 2


def test_provider_reset_is_unavailable_for_archived_period(api, db, period):
    log_data = draft_log(api, "hcp1", period)
    log = db.get(WorkLog, log_data["id"])
    db.get(PayPeriod, period["id"]).status = "ARCHIVED"
    db.commit()
    api.post(
        f"/admin/pay-periods/{period['id']}/providers/{log.staff_id}/reset-records",
        "admin",
        {"reason": "Restart testing", "confirmation": f"RESET hcp1 {period['id']}"},
        expect=409,
    )
    db.expire_all()
    assert db.query(WorkLogEntry).filter_by(work_log_id=log.id).count() == 2
