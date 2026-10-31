"""Corrections restart approval; period restarts preserve immutable history."""
from datetime import date

import pytest

from backend.models import AuditEvent, PayPeriod, WorkLog, WorkLogAudit, WorkLogEntry
from .conftest import draft_log, ENTRY
from .test_date_corrections import period_body


@pytest.mark.parametrize("provider", ["chw1", "hcp1", "clerk1"])
@pytest.mark.parametrize("stage,reviewer", [
    ("PENDING_TECHNICAL_REVIEW", "tofficer1"),
    ("PENDING_RPM_AUTHORIZATION", "rpm1"),
])
def test_rejection_opens_full_month_and_restarts_review(api, db, period, provider, stage, reviewer):
    log = draft_log(api, provider, period)
    stored = db.get(WorkLog, log["id"])
    stored.status = stage
    stored.confirmed_version = stored.version
    db.commit()
    rejected = api.post(f"/worklogs/{stored.id}/actions/reject", reviewer, {"comment": "Correct the monthly work"})
    assert rejected["status"] == "REJECTED"
    rejected = api.get(f"/worklogs/{stored.id}", provider)
    assert rejected["status"] == "REJECTED" and rejected["can_edit"]
    assert rejected["confirmed_version"] is None
    assert "submit" in rejected["available_actions"]
    # Correct an existing day and add another workday near the end of the same month.
    first = date.fromisoformat(period["start_date"])
    last = date.fromisoformat(period["end_date"])
    # Sundays remain excluded by the existing work policy.
    while last.weekday() >= 5:
        from datetime import timedelta
        last -= timedelta(days=1)
    for day in (first, last):
        api.put(f"/worklogs/{stored.id}/entries/{day}", provider, ENTRY[
            {"chw1": "CHW", "hcp1": "HCP", "clerk1": "DATA_CLERK"}[provider]](day))
    assert db.query(WorkLogAudit).filter_by(work_log_id=stored.id, action="reject").count() == 1
    submitted = api.post(f"/worklogs/{stored.id}/actions/submit", provider, {"attest": True})
    assert submitted["status"] == "PENDING_CTC_VERIFICATION" and not submitted["can_edit"]
    other = "hcp2" if provider != "hcp2" else "chw1"
    api.put(f"/worklogs/{stored.id}/entries/{first}", other, ENTRY["HCP"](first), expect=404)


@pytest.mark.parametrize("workflow_version", [1, 2])
def test_provider_can_recall_unreviewed_submission_and_edit_saved_entries(api, db, period, workflow_version):
    log = draft_log(api, "hcp1", period)
    stored = db.get(WorkLog, log["id"])
    stored.status = "PENDING_CTC_VERIFICATION"
    stored.workflow_version = workflow_version
    stored.attested_at = stored.created_at
    stored.submitted_at = stored.created_at
    db.commit()
    entry_dates = [row.entry_date for row in db.query(WorkLogEntry).filter_by(work_log_id=stored.id).all()]
    path = f"/worklogs/{stored.id}/actions/recall"

    submitted = api.get(f"/worklogs/{stored.id}", "hcp1")
    assert "recall" in submitted["available_actions"]
    # Work-log visibility is scoped, so another provider cannot discover it.
    api.post(path, "hcp2", {"expected_version": stored.version}, expect=404)

    reopened = api.post(path, "hcp1", {
        "expected_version": stored.version,
        "comment": "I need to complete the monthly entries",
    })
    assert reopened["status"] == "DRAFT"
    assert reopened["can_edit"] is True
    assert reopened["submitted_at"] is None
    assert reopened["attested_at"] is None
    assert [row.entry_date for row in db.query(WorkLogEntry).filter_by(work_log_id=stored.id).all()] == entry_dates
    assert db.query(WorkLogAudit).filter_by(work_log_id=stored.id, action="recall").count() == 1

    # A legacy form fixture validates that a saved day can actually be corrected;
    # the v2 fixture's legacy activity key is intentionally not accepted by its catalog.
    if workflow_version == 1:
        first = entry_dates[0]
        api.put(f"/worklogs/{stored.id}/entries/{first}", "hcp1", ENTRY["HCP"](first))


def test_provider_cannot_recall_after_ctc_review_has_moved_the_record_forward(api, db, period):
    log = draft_log(api, "hcp1", period)
    stored = db.get(WorkLog, log["id"])
    stored.status = "PENDING_TECHNICAL_REVIEW"
    stored.workflow_version = 2
    db.commit()

    result = api.get(f"/worklogs/{stored.id}", "hcp1")
    assert "recall" not in result["available_actions"]
    api.post(
        f"/worklogs/{stored.id}/actions/recall",
        "hcp1",
        {"expected_version": stored.version},
        expect=409,
    )


def archive(api, period, **updates):
    return api.post(f"/admin/pay-periods/{period['id']}/archive", "admin", {
        "reason": "Restart monthly work after testing",
        "confirmation": f"ARCHIVE {period['id']}", **updates,
    })


@pytest.mark.parametrize("old_status", ["APPROVED", "REJECTED"])
@pytest.mark.parametrize("regional", [False, True])
def test_archive_preserves_used_work_and_allows_fresh_period(api, db, period, old_status, regional):
    if regional:
        region_id = api.get("/admin/pay-period-regions", "tofficer1")[0]["id"]
        period = api.post("/admin/pay-periods", "admin", period_body(period, region_id=region_id), expect=201)
    log = draft_log(api, "hcp1", period)
    stored = db.get(WorkLog, log["id"])
    stored.status = old_status
    db.commit()
    entry_ids = [r.id for r in db.query(WorkLogEntry).filter_by(work_log_id=stored.id)]
    audits = db.query(WorkLogAudit).filter_by(work_log_id=stored.id).count()
    result = archive(api, period)
    assert result["preserved_work_by_status"] == {old_status: 1}
    db.expire_all()
    assert db.get(PayPeriod, period["id"]).status == "ARCHIVED"
    assert db.get(WorkLog, stored.id).status == old_status
    assert [r.id for r in db.query(WorkLogEntry).filter_by(work_log_id=stored.id)] == entry_ids
    assert db.query(WorkLogAudit).filter_by(work_log_id=stored.id).count() == audits
    assert db.query(AuditEvent).filter_by(entity_type="pay-periods", entity_id=str(period["id"]), action="archive").count() == 1
    assert period["id"] not in {p["id"] for p in api.get("/admin/pay-periods", "hcp1")}
    assert period["id"] in {p["id"] for p in api.get("/admin/pay-periods?include_archived=true", "admin")}
    assert stored.id not in {r["id"] for r in api.get("/worklogs?mine=true", "hcp1")}
    detail = api.get(f"/worklogs/{stored.id}", "hcp1")
    assert not detail["can_edit"] and detail["available_actions"] == []
    first = date.fromisoformat(period["start_date"])
    api.put(f"/worklogs/{stored.id}/entries/{first}", "hcp1", ENTRY["HCP"](first), expect=409)
    api.post("/worklogs", "hcp1", {"period_id": period["id"]}, expect=409)
    fresh = api.post("/admin/pay-periods", "admin", period_body(period), expect=201)
    assert fresh["id"] != period["id"]
    new_log = api.post("/worklogs", "hcp1", {"period_id": fresh["id"]}, expect=201)
    assert new_log["entries"] == [] and new_log["can_edit"]
    api.put(f"/admin/pay-periods/{period['id']}", "admin", period_body(period), expect=409)


def test_archive_requires_super_admin_explicit_confirmation_and_preserves_paid_work(api, db, period):
    body = {"reason": "Restart the period", "confirmation": f"ARCHIVE {period['id']}"}
    for actor in ("tofficer1", "rpm1", "hcp1"):
        api.post(f"/admin/pay-periods/{period['id']}/archive", actor, body, expect=403)
    api.get("/admin/pay-periods?include_archived=true", "hcp1", expect=403)
    api.post(f"/admin/pay-periods/{period['id']}/archive", "admin",
             {**body, "confirmation": "ARCHIVE"}, expect=422)
    log = draft_log(api, "hcp1", period)
    db.get(WorkLog, log["id"]).status = "PAID"
    db.commit()
    api.post(f"/admin/pay-periods/{period['id']}/archive", "admin", body, expect=409)
    assert db.get(PayPeriod, period["id"]).status == "OPEN"
    assert db.query(WorkLogEntry).filter_by(work_log_id=log["id"]).count() == 2


def test_active_or_paid_claims_block_archive_cancelled_claims_are_preserved(api, db, period):
    from backend.models import ClaimCategory, PaymentClaim, User
    log = draft_log(api, "hcp1", period)
    claim = PaymentClaim(staff_id=log["staff_id"], work_log_id=log["id"], period_id=period["id"],
                         category_id=db.query(ClaimCategory).first().id,
                         created_by=db.query(User).filter_by(username="admin").one().id)
    db.add(claim)
    db.commit()
    body = {"reason": "Restart period", "confirmation": f"ARCHIVE {period['id']}"}
    for status in ("DRAFT", "APPROVED", "PAID"):
        claim.status = status
        db.commit()
        api.post(f"/admin/pay-periods/{period['id']}/archive", "admin", body, expect=409)
        assert db.get(PayPeriod, period["id"]).status == "OPEN"
    claim.status = "CANCELLED"
    db.commit()
    archive(api, period)
    db.expire_all()
    assert db.get(PaymentClaim, claim.id).status == "CANCELLED"
