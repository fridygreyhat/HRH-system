from datetime import date, timedelta
from decimal import Decimal
import importlib

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations

from backend.models import (
    BudgetTransaction, Cadre, ClaimAudit, PaymentClaim, Region, StaffAssignment,
    User, UserReviewCadre, UserScope, WorkLogAudit, WorkLogEntry, WorkLogMeasure, utcnow,
)
from .conftest import category_id
from .test_ctc_facility_approval import no_provider_sms
from .test_finance_missing_rates import unpriced_log
from .test_v22_finance import v22


def all_cadres(db, username):
    actor = db.query(User).filter_by(username=username).one()
    for cadre in db.query(Cadre):
        if not db.get(UserReviewCadre, (actor.id, cadre.id)):
            db.add(UserReviewCadre(user_id=actor.id, cadre_id=cadre.id))
    db.commit()


@pytest.mark.parametrize("provider", ["chw1", "hcp1", "clerk1"])
def test_payroll_entire_work_approval_chain_without_finance(api, db, period, v22, no_provider_sms, provider):
    log, entry, _ = unpriced_log(db, period, provider, "PAYROLL")
    log.status = "DRAFT"
    while entry.entry_date.weekday() > 4:
        entry.entry_date += timedelta(days=1)
    log.attested_at = utcnow()
    db.commit()
    all_cadres(db, "tofficer1")
    all_cadres(db, v22["finance"])
    body = {"review_confirmed": True, "review_type": "PAYROLL"}
    assert api.post(f"/worklogs/{log.id}/actions/submit", provider, {"attest": True})["status"] == "PENDING_CTC_VERIFICATION"
    assert api.post(f"/worklogs/{log.id}/actions/verify", "supervisor1", body)["status"] == "PENDING_TECHNICAL_REVIEW"
    assert api.post(f"/worklogs/{log.id}/actions/endorse", "tofficer1", body)["status"] == "PENDING_RPM_AUTHORIZATION"
    # The RM must not see a budget-hold action for Payroll.
    assert "hold" not in api.get(f"/worklogs/{log.id}", "rpm1")["available_actions"]
    result = api.post(f"/worklogs/{log.id}/actions/authorize", "rpm1", body)
    assert result["status"] == "APPROVED" and result["approved_at"]
    assert result["financial_preview"] is None and result["claims"] == []
    assert api.get(f"/worklogs/{log.id}/estimate", v22["finance"]) == {
        "lines": [], "totals": [], "exceptions": [], "report_only": True,
    }
    api.post(f"/worklogs/{log.id}/actions/finance_review", v22["finance"], body, expect=403)
    api.post("/finance/channel", v22["finance"], {**body, "work_log_id": log.id, "target_payor_id": 1}, expect=409)
    assert log.id not in {row["work_log_id"] for row in api.get("/finance/pending-routing", v22["finance"])}
    assert db.query(PaymentClaim).filter_by(work_log_id=log.id).count() == 0
    assert db.query(BudgetTransaction).join(PaymentClaim, PaymentClaim.id == BudgetTransaction.claim_id).filter(
        PaymentClaim.work_log_id == log.id).count() == 0
    assert api.get(f"/worklogs/{log.id}", "rpm1")["available_actions"] == ["reopen"]


def test_monthly_report_aggregates_all_cadres_and_only_requested_dates(api, db, period, v22):
    all_cadres(db, v22["finance"])
    first = date.fromisoformat(period["start_date"])
    next_month = (first.replace(day=1) + timedelta(days=32)).strftime("%Y-%m")
    baseline_next_hours = Decimal(api.get(f"/finance/monthly-summary?month={next_month}", v22["finance"])["totals"]["hours"])
    month = first.strftime("%Y-%m")
    for provider in ("chw1", "hcp1", "clerk1"):
        log, entry, _ = unpriced_log(db, period, provider, "PAYROLL")
        log.status, log.approved_at = "APPROVED", utcnow()
        entry.activity_snapshot = {**entry.activity_snapshot, "field_definitions": [
            {"key": "clients", "label_en": "Clients served"}],
            "additional_services": [{"activity": {"field_definitions": [
                {"key": "followed", "label_en": "Clients followed up"}]}, "measures": {"followed": 3}}]}
        db.add(WorkLogMeasure(entry_id=entry.id, field_key="clients", value=5))
        # A multi-month period must not cause next month's work to leak into this report.
        db.add(WorkLogEntry(work_log_id=log.id, entry_date=first + timedelta(days=40),
                           hours_worked=7, evidence_text="Other calendar month"))
    unpriced_log(db, period, "chw1", "SERVICES")
    db.commit()
    report = api.get(f"/finance/monthly-summary?month={month}", v22["finance"])
    assert report["totals"]["providers"] == 3 and report["totals"]["days"] == 3
    assert report["totals"]["logs"] == 3 and Decimal(report["totals"]["hours"]) == 24
    assert {row["code"] for row in report["cadres"]} == {"CHW", "HCP", "DATA_CLERK"}
    assert len(report["providers"]) == 3
    for finance_user in ("fhifin1", "csofin1"):
        all_cadres(db, finance_user)
        assert api.get(f"/finance/monthly-summary?month={month}", finance_user)["totals"]["providers"] == 3
    # csofin1 and csofin2 are the same-CSO maker/checker pair. Use the
    # genuinely different CSO actor, with region/cadres explicitly granted,
    # so denial proves the organization boundary rather than missing scope.
    foreign_finance = db.query(User).filter_by(username="csofin3").one()
    db.add(UserScope(user_id=foreign_finance.id, region_id=v22["region_id"]))
    db.commit()
    all_cadres(db, "csofin3")
    assert api.get(f"/finance/monthly-summary?month={month}", "csofin3")["providers"] == []
    for row in report["providers"]:
        assert row["days"] == 1 and Decimal(row["hours"]) == 8
        assert {item["key"]: Decimal(item["total"]) for item in row["indicators"]} == {"clients": 5, "followed": 3}
        assert "entries" not in row and "gps_lat" not in row
    # An earlier/later month shows its own recorded dates, not the full period.
    next_month = (first + timedelta(days=40)).strftime("%Y-%m")
    assert Decimal(api.get(f"/finance/monthly-summary?month={next_month}", v22["finance"])["totals"]["hours"]) == baseline_next_hours + 21
    assert api.get(f"/finance/monthly-summary?month={month}&work_type=SERVICES", v22["finance"])["providers"] == []
    api.get(f"/finance/monthly-summary?month={month}", "chw1", expect=403)
    api.get("/finance/monthly-summary?month=2026-13", v22["finance"], expect=422)
    api.get("/finance/monthly-summary?month=0943-01", v22["finance"], expect=422)


def test_report_never_expands_region_or_cadre_assignments(api, db, period, v22):
    first = date.fromisoformat(period["start_date"])
    for provider in ("chw1", "hcp1"):
        log, _, _ = unpriced_log(db, period, provider, "PAYROLL")
        log.status, log.approved_at = "APPROVED", utcnow()
    db.commit()
    path = f"/finance/monthly-summary?month={first:%Y-%m}"
    report = api.get(path, v22["finance"])
    assert {row["cadre_code"] for row in report["providers"]} == {"CHW"}
    foreign = db.query(Region).filter(Region.id != v22["region_id"]).first()
    assert api.get(f"{path}&region_id={foreign.id}", v22["finance"])["providers"] == []
    finance = db.query(User).filter_by(username=v22["finance"]).one()
    db.query(UserReviewCadre).filter_by(user_id=finance.id).delete()
    db.commit()
    assert api.get(path, v22["finance"])["providers"] == []


@pytest.mark.parametrize("status", ["DRAFT", "PENDING_CTC_VERIFICATION", "PENDING_TECHNICAL_REVIEW",
                                    "PENDING_RPM_AUTHORIZATION", "RETURNED_TO_PROVIDER", "BUDGET_HOLD"])
def test_unapproved_work_is_not_reported_to_finance(api, db, period, v22, status):
    log, entry, _ = unpriced_log(db, period, "chw1", "PAYROLL")
    log.status = status
    db.commit()
    report = api.get(f"/finance/monthly-summary?month={entry.entry_date:%Y-%m}", v22["finance"])
    assert report["providers"] == [] and report["totals"]["logs"] == 0


def test_policy_upgrade_retains_rm_approval_and_protects_payment_history(api, db, period, v22):
    log, _, _ = unpriced_log(db, period, "chw1", "PAYROLL")
    log.status, log.approved_at = "PENDING_FINANCE_REVIEW", utcnow()
    admin = db.query(User).filter_by(username="admin").one()
    proposal = PaymentClaim(work_log_id=log.id, staff_id=log.staff_id, period_id=log.period_id,
        workflow_version=2, work_type="PAYROLL", status="PENDING_FINANCE_REVIEW",
        payment_status="NOT_STARTED", amount=123, created_by=admin.id)
    db.add(proposal)
    protected, _, _ = unpriced_log(db, period, "hcp1", "PAYROLL")
    protected.status, protected.approved_at = "PENDING_FINANCE_REVIEW", utcnow()
    paid = PaymentClaim(work_log_id=protected.id, staff_id=protected.staff_id, period_id=protected.period_id,
        category_id=category_id(db, "B"), workflow_version=2, work_type="PAYROLL",
        status="PAID", payment_status="FULLY_PAID", amount=90000, created_by=admin.id,
        calculation_snapshot={"historical": True})
    db.add(paid)
    held, _, _ = unpriced_log(db, period, "clerk1", "PAYROLL")
    held.status = "BUDGET_HOLD"
    db.commit()
    revision = importlib.import_module("backend.alembic.versions.07a5e29c4301_payroll_work_reports")
    with Operations.context(MigrationContext.configure(db.connection())):
        revision.upgrade()
    db.commit()
    db.refresh(log)
    db.refresh(proposal)
    db.refresh(paid)
    db.refresh(held)
    assert log.status == "APPROVED" and log.approved_at is not None
    assert proposal.status == "CANCELLED"
    assert held.status == "PENDING_RPM_AUTHORIZATION" and held.approved_at is None
    assert paid.status == "PAID" and paid.amount == 90000 and paid.calculation_snapshot == {"historical": True}
    assert db.query(ClaimAudit).filter_by(claim_id=proposal.id, action="payroll_reporting_policy").count() == 1
    assert db.query(WorkLogAudit).filter_by(work_log_id=log.id, action="payroll_reporting_policy").count() == 1
    with Operations.context(MigrationContext.configure(db.connection())):
        revision.upgrade()
    db.commit()
    assert db.query(WorkLogAudit).filter_by(work_log_id=log.id, action="payroll_reporting_policy").count() == 1
