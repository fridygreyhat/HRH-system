"""A guarded, audited work reset never alters financial records or another month."""
from datetime import date

import pytest

from .conftest import category_id
from .test_ctc_facility_approval import no_provider_sms


def test_october_restart_preserves_budget_history_and_rejects_unsafe_requests(api, db, period, monkeypatch):
    from backend.core import workflow_policy
    from backend.models import (
        AuditEvent, BudgetLine, BudgetTransaction, OTPChallenge, PaymentClaim, PayPeriod,
        SMSOutbox, User, WorkLog, WorkLogAudit, WorkLogEntry, WorkLogVersion, utcnow,
    )
    monkeypatch.setattr(workflow_policy, "NEW_RECORD_WORKFLOW_VERSION", 2)
    october = next((row for row in api.get("/admin/pay-periods", "admin")
                    if row["start_date"] == "2026-10-01" and row["end_date"] == "2026-10-31" and row["region_id"] is None), None)
    if october is None:
        october = api.post("/admin/pay-periods", "admin", {
            "start_date": "2026-10-01", "end_date": "2026-10-31",
            "period_label": "October reset acceptance", "status": "OPEN",
        })
    source = db.query(BudgetLine).filter_by(period_id=period["id"]).first()
    budget = api.post("/budgets/lines", "admin", {
        "code": "OCT-RESET-TEST", "name": "Protected October budget",
        "organization_id": source.organization_id, "category_id": source.category_id,
        "period_id": october["id"], "region_id": source.region_id,
        "allocated_amount": 100000000,
    })
    line = db.get(BudgetLine, budget["id"])
    budget_before = (line.allocated_amount, line.committed_amount, line.spent_amount)
    all_budgets_before = [(r.id, r.allocated_amount, r.committed_amount, r.spent_amount)
                          for r in db.query(BudgetLine).filter_by(period_id=october["id"]).order_by(BudgetLine.id)]
    ledger_before = [(r.id, r.kind, r.amount) for r in db.query(BudgetTransaction).filter_by(budget_line_id=line.id)]
    other = api.post("/worklogs", "chw1", {"period_id": period["id"], "work_type": "PAYROLL"})
    other = api.put(f"/worklogs/{other['id']}/entries/{period['start_date']}", "chw1", {
        "activity_key": "daily_attendance", "hours_worked": 8, "measures": {},
    })
    log = api.post("/worklogs", "chw1", {"period_id": october["id"], "work_type": "PAYROLL"})
    path = f"/worklogs/{log['id']}"
    log = api.put(path + "/entries/2026-10-01", "chw1", {
        "activity_key": "daily_attendance", "hours_worked": 8, "measures": {},
    })
    review = {"review_confirmed": True, "review_type": "PAYROLL"}
    api.post(path + "/actions/submit", "chw1", {"attest": True})
    api.post(path + "/actions/verify", "supervisor1", review)
    api.post(path + "/actions/endorse", "tofficer1", review)
    log = api.post(path + "/actions/authorize", "rpm1", review)
    assert log["status"] == "PENDING_FINANCE_REVIEW" and not log["claims"]
    old_audits = {a.id for a in db.query(WorkLogAudit).filter_by(work_log_id=log["id"])}
    old_versions = {v.version for v in db.query(WorkLogVersion).filter_by(work_log_id=log["id"])}
    db.add(OTPChallenge(work_log_id=log["id"], version=log["version"],
                        code_hash="synthetic-inactive-test-code", expires_at=utcnow(), is_used=False))
    notice = SMSOutbox(event_name="RESET_TEST", related_type="work_log", related_id=log["id"],
                       destination_phone="+255700000000", message_body="Synthetic queued notice", status="PENDING")
    db.add(notice)
    db.commit()
    root = f"/admin/pay-periods/{october['id']}"
    preview = api.get(root + "/work-reset-preview", "admin")
    assert preview["can_reset"] and preview["counts"]["daily_entries"] == 1
    assert preview["counts"]["budget_lines_preserved"] == len(all_budgets_before)
    body = {"confirmation": preview["confirmation"], "preview_token": preview["preview_token"],
            "reason": "Restart October with empty work records."}
    for actor in ("central1", "fhifin1", "tofficer1", "rpm1", "chw1"):
        api.get(root + "/work-reset-preview", actor, expect=403)
        api.post(root + "/clear-work-records", actor, body, expect=403)
    api.post(root + "/clear-work-records", "admin", {**body, "confirmation": "wrong"}, expect=422)
    # Review must be repeated after a work entry changes.
    entry = db.query(WorkLogEntry).filter_by(work_log_id=log["id"]).one()
    entry.hours_worked = 7
    db.commit()
    stale = api.post(root + "/clear-work-records", "admin", body, expect=409)
    assert "changed since your review" in stale["detail"]
    # Any newly-created claim blocks reset, including an unpaid draft.
    admin_id = db.query(User.id).filter_by(username="admin").scalar()
    synthetic_claim = PaymentClaim(workflow_version=2, work_type="PAYROLL", work_log_id=log["id"],
        staff_id=log["staff"]["id"], assignment_id=log["assignment"]["id"], period_id=october["id"],
        category_id=source.category_id, amount=1, currency="TZS", status="DRAFT", created_by=admin_id)
    db.add(synthetic_claim)
    db.commit()
    assert not api.get(root + "/work-reset-preview", "admin")["can_reset"]
    api.post(root + "/clear-work-records", "admin", body, expect=409)
    db.delete(synthetic_claim)
    db.commit()
    line.committed_amount = 1
    db.commit()
    assert not api.get(root + "/work-reset-preview", "admin")["can_reset"]
    api.post(root + "/clear-work-records", "admin", body, expect=409)
    line.committed_amount = 0
    db.commit()
    preview = api.get(root + "/work-reset-preview", "admin")
    body["preview_token"] = preview["preview_token"]
    # A failure after deleting entries must roll the entire operation back.
    with monkeypatch.context() as patch:
        def fail_audit(*args, **kwargs):
            raise RuntimeError("Synthetic transaction failure")
        patch.setattr("backend.services.period_work_reset.audit.record", fail_audit)
        with pytest.raises(RuntimeError, match="Synthetic transaction failure"):
            api.post(root + "/clear-work-records", "admin", body)
    assert api.get(path, "chw1")["status"] == "PENDING_FINANCE_REVIEW"
    assert len(api.get(path, "chw1")["entries"]) == 1
    result = api.post(root + "/clear-work-records", "admin", body)
    assert result["cleared"]
    fresh = api.get(path, "chw1")
    assert fresh["status"] == "DRAFT" and fresh["entries"] == []
    assert fresh["approved_at"] is None and fresh["submitted_at"] is None
    assert fresh["can_edit"] and fresh["available_actions"] == ["submit", "cancel"]
    db.expire_all()
    assert old_audits <= {a.id for a in db.query(WorkLogAudit).filter_by(work_log_id=log["id"])}
    assert old_versions < {v.version for v in db.query(WorkLogVersion).filter_by(work_log_id=log["id"])}
    backup = db.query(WorkLogVersion).filter_by(work_log_id=log["id"]).order_by(WorkLogVersion.version.desc()).first()
    assert backup.snapshot["captured_before_reset"] and len(backup.snapshot["entries"]) == 1
    assert db.query(WorkLogAudit).filter_by(work_log_id=log["id"], action="reset_work_records").count() == 1
    assert db.query(AuditEvent).filter_by(entity_type="pay-periods", entity_id=str(october["id"]), action="clear_work_records").count() == 1
    assert db.get(SMSOutbox, notice.id).status == "SUPPRESSED"
    assert all(row.is_used for row in db.query(OTPChallenge).filter_by(work_log_id=log["id"]))
    assert db.get(PayPeriod, october["id"]).status == "OPEN"
    line = db.get(BudgetLine, budget["id"])
    assert (line.allocated_amount, line.committed_amount, line.spent_amount) == budget_before
    assert [(r.id, r.allocated_amount, r.committed_amount, r.spent_amount)
            for r in db.query(BudgetLine).filter_by(period_id=october["id"]).order_by(BudgetLine.id)] == all_budgets_before
    assert [(r.id, r.kind, r.amount) for r in db.query(BudgetTransaction).filter_by(budget_line_id=line.id)] == ledger_before
    assert len(api.get(f"/worklogs/{other['id']}", "chw1")["entries"]) == 1
    api.post(root + "/clear-work-records", "admin", body, expect=409)
    # The same retained work log is ready for a completely fresh entry.
    fresh = api.put(path + "/entries/2026-10-01", "chw1", {
        "activity_key": "daily_attendance", "hours_worked": 8, "measures": {},
    })
    assert fresh["totals"]["hours"] == 8


def test_restart_cannot_target_other_months(api, period):
    api.get(f"/admin/pay-periods/{period['id']}/work-reset-preview", "admin", expect=422)
