"""Regional Finance approves clean timesheets in bulk (1,000+ a region), Payroll and Services; flagged ones one by one."""
import pytest

from backend.models import FundingSource, WorkLog
from backend.services import finance_bulk
from .monthly_budget_setup import ensure_monthly_budgets
from .test_approval_finance_visibility import approve_to_regional_finance, prepare
from .test_ctc_facility_approval import no_provider_sms
from .test_finance_monthly_reports import all_cadres
from .test_finance_pack import month_of
from .test_services_without_budgets import empty_period
from .test_v22_finance import v22

pytestmark = pytest.mark.usefixtures("no_provider_sms")


def test_payroll_must_be_approved_before_the_month_is_signed_and_sent(api, db, period, v22, monkeypatch):
    rf = v22["finance"]
    all_cadres(db, rf)
    logs = [approve_to_regional_finance(api, prepare(api, db, period, v22, who, "PAYROLL"), rf) for who in ("chw1", "hcp1")]
    month, region = month_of(db, logs[0]["id"]), v22["region_id"]
    listing = api.get(f"/finance/bulk-review?work_type=PAYROLL&month={month}&region_id={region}", rf)
    ids = {row["work_log_id"] for row in listing["rows"]}
    assert {log["id"] for log in logs} <= ids and listing["counts"]["total"] == len(listing["rows"])

    # Signing is refused while any Payroll timesheet of the month waits for Regional Finance.
    report = api.get(f"/finance/monthly-report?month={month}&region_id={region}&work_type=PAYROLL", rf)
    refused = api.call("POST", "/finance/monthly-report/approve", rf, json={
        "month": month, "region_id": region, "work_type": "PAYROLL", "review_confirmed": True, "expected_digest": report["digest"]}, expect=409)
    assert "not approved yet" in refused["detail"]

    # One flagged timesheet is set aside; the clean one is approved in bulk.
    flagged = logs[1]["id"]
    real = finance_bulk.flags
    monkeypatch.setattr(finance_bulk, "flags", lambda db, current, log: ["Hours look wrong"] if log.id == flagged else [])
    body = {"work_type": "PAYROLL", "month": month, "region_id": region, "work_log_ids": sorted(ids), "review_confirmed": True}
    api.post("/finance/bulk-approve", rf, {**body, "review_confirmed": False}, expect=422)
    api.post("/finance/bulk-approve", "csofin1", body, expect=403)
    result = api.post("/finance/bulk-approve", rf, body)
    assert logs[0]["id"] in result["approved"] and flagged not in result["approved"]
    assert any(s["work_log_id"] == flagged and "Hours look wrong" in s["reason"] for s in result["skipped"])
    db.expire_all()
    assert db.get(WorkLog, logs[0]["id"]).finance_timesheet_approved_at and db.get(WorkLog, logs[0]["id"]).status == "APPROVED"
    monkeypatch.setattr(finance_bulk, "flags", real)

    # The flagged one is returned to its provider one by one; the month can then be signed and sent.
    api.post(f"/worklogs/{flagged}/actions/return", rf, {"comment": "Hours look wrong", "review_confirmed": True, "review_type": "PAYROLL"})
    db.expire_all()
    assert db.get(WorkLog, flagged).status == "RETURNED_TO_PROVIDER"
    for row in api.get(f"/finance/bulk-review?work_type=PAYROLL&month={month}&region_id={region}", rf)["rows"]:
        api.post(f"/worklogs/{row['work_log_id']}/actions/finance_timesheet_approve", rf, {"review_confirmed": True, "review_type": "PAYROLL"})
    report = api.get(f"/finance/monthly-report?month={month}&region_id={region}&work_type=PAYROLL", rf)
    signed = api.call("POST", "/finance/monthly-report/approve", rf, json={
        "month": month, "region_id": region, "work_type": "PAYROLL", "review_confirmed": True, "expected_digest": report["digest"]})
    assert signed["state"] == "APPROVED"


def test_services_are_approved_in_bulk_then_sent_by_month(api, db, empty_period, v22, monkeypatch):
    rf = v22["finance"]
    for user in (rf, "fhifin1"):
        all_cadres(db, user)
    logs = [approve_to_regional_finance(api, prepare(api, db, empty_period, v22, who, "SERVICES"), rf) for who in ("chw1", "hcp1")]
    month, region = month_of(db, logs[0]["id"]), v22["region_id"]
    listing = api.get(f"/finance/bulk-review?work_type=SERVICES&month={month}&region_id={region}", rf)
    rows = {row["work_log_id"]: row for row in listing["rows"]}
    assert all(rows[log["id"]]["step"] == "timesheet" and rows[log["id"]]["amount"] for log in logs)
    monkeypatch.setattr(finance_bulk, "flags", lambda db, current, log: [])
    source = db.query(FundingSource).filter_by(name="PnP").one()
    body = {"work_type": "SERVICES", "month": month, "region_id": region, "work_log_ids": [log["id"] for log in logs], "review_confirmed": True}
    api.post("/finance/bulk-approve", rf, body, expect=422)  # Services need the funding source
    result = api.post("/finance/bulk-approve", rf, {**body, "funding_source_id": source.id})
    assert sorted(result["approved"]) == sorted(log["id"] for log in logs), result["skipped"]
    db.expire_all()
    assert all(db.get(WorkLog, log["id"]).status == "FINANCE_REVIEWED" for log in logs)  # timesheet and amount both approved
    for log in logs:
        ensure_monthly_budgets(db, log["id"], rf)
    # Nothing is sent by approving: the month goes to Central Finance as its own step.
    status = api.get(f"/finance/services-month?month={month}&region_id={region}", rf)
    assert status["counts"]["ready"] >= 2
    reviewer = next(r for r in status["central_reviewers"] if r["username"] == "fhifin1")
    sent = api.post("/finance/services-month/send", rf, {"month": month, "region_id": region, "central_reviewer_id": reviewer["id"], "review_confirmed": True})
    assert {log["id"] for log in logs} <= {row["work_log_id"] for row in sent["sent"]}


def test_bulk_approval_takes_a_limited_number_at_a_time(api, v22):
    body = {"work_type": "PAYROLL", "month": "2026-01", "region_id": v22["region_id"], "review_confirmed": True,
            "work_log_ids": list(range(1, finance_bulk.MAX_PER_REQUEST + 2))}
    api.post("/finance/bulk-approve", v22["finance"], body, expect=422)
