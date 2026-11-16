"""A signed Payroll month is taken back when a timesheet on it leaves approval, until Regional Finance signs again."""
import pytest

from backend.models import FinanceMonthlyReport, FinanceMonthlyReportWithdrawal, Staff, StaffAssignment, WorkLog
from .test_approval_finance_visibility import approve_to_regional_finance, prepare
from .test_ctc_facility_approval import no_provider_sms
from .test_finance_monthly_reports import all_cadres
from .test_finance_pack import month_of
from .test_services_without_budgets import empty_period
from .test_v22_finance import v22

pytestmark = pytest.mark.usefixtures("no_provider_sms")


def cso_status(db, month, region):
    from datetime import timedelta
    from backend.core.period_dates import pay_month_range
    from backend.core.security import load_current_user
    from backend.models import User
    from backend.services import monthly_report_approval as reports
    db.expire_all()
    cso = load_current_user(db, db.query(User).filter_by(username="csofin1").one())
    after = pay_month_range(month)[1] + timedelta(days=1)
    return next(i for i in reports.cso_payroll_status(db, cso, after) if i["region_id"] == region and i["month"] == month)


def test_returning_a_signed_payroll_timesheet_takes_the_month_back_from_the_cso_until_it_is_signed_again(api, db, empty_period, v22):
    rf = v22["finance"]
    for user in (rf, "csofin1"):
        all_cadres(db, user)
    log = approve_to_regional_finance(api, prepare(api, db, empty_period, v22, "chw1", "PAYROLL"), rf)
    month, placement = month_of(db, log["id"]), db.get(StaffAssignment, log["assignment_id"])
    region, query = placement.region_id, f"cso_id={placement.organization_id}&month={month}"
    name = db.get(Staff, log["staff_id"]).legal_name

    def cso_has_them():
        listed = api.get(f"/cso-finance/salary-timesheets?{query}", "csofin1")["providers"]
        form = api.get(f"/cso-finance/payment-form?{query}", "csofin1")["rows"]
        assert (log["staff_id"] in {p["staff_id"] for p in listed}) == (name in {r["name"] for r in form})
        return log["staff_id"] in {p["staff_id"] for p in listed}

    def sign():
        # Regional Finance's own steps: approve the timesheet on the "Approve timesheets" page, then sign the month.
        api.call("POST", "/finance/bulk-approve", rf, json={"work_type": "PAYROLL", "month": month, "region_id": region,
                                                            "work_log_ids": [log["id"]], "review_confirmed": True})
        report = api.get(f"/finance/monthly-report?month={month}&region_id={region}&work_type=PAYROLL", rf)
        api.post("/finance/monthly-report/approve", rf, {"month": month, "region_id": region, "work_type": "PAYROLL",
                                                          "review_confirmed": True, "expected_digest": report["digest"]})

    sign()
    assert cso_has_them()
    signoffs = db.query(FinanceMonthlyReport).filter_by(month=month, region_id=region, work_type="PAYROLL").count()

    # 1. Regional Finance returns the timesheet after signing: the CSO no longer sees the month as signed.
    returned = api.post(f"/worklogs/{log['id']}/actions/return", rf, {"review_confirmed": True, "review_type": "PAYROLL",
                                                                      "comment": "Two days are on leave"})
    assert returned["status"] == "RETURNED_TO_PROVIDER"
    assert not cso_has_them()
    report = api.get(f"/finance/monthly-report?month={month}&region_id={region}&work_type=PAYROLL", rf)
    assert report["state"] == "NOT_APPROVED" and name in report["withdrawn"]["reason"]
    # The CSO is told the month was taken back, even though nobody on it is approved now.
    taken_back = cso_status(db, month, region)
    assert taken_back["state"] == "WAITING" and taken_back["signed_providers"] == 0 and taken_back["withdrawn"]
    # The signed document is kept for the record; only a withdrawal is added.
    db.expire_all()
    assert db.query(FinanceMonthlyReport).filter_by(month=month, region_id=region, work_type="PAYROLL").count() == signoffs
    latest = db.query(FinanceMonthlyReport).filter_by(month=month, region_id=region, work_type="PAYROLL").order_by(FinanceMonthlyReport.id.desc()).first()
    taken = db.query(FinanceMonthlyReportWithdrawal).filter_by(report_id=latest.id).one()
    assert taken.work_log_id == log["id"] and taken.withdrawn_by

    # 2. The provider corrects and resubmits; after the approvals Regional Finance signs again and the CSO has it back.
    api.post(f"/worklogs/{log['id']}/actions/submit", "chw1", {"attest": True})
    log = approve_to_regional_finance(api, api.get(f"/worklogs/{log['id']}", "chw1"), rf)
    assert not cso_has_them()  # approved again, but not signed again yet
    sign()
    assert cso_has_them()
    db.expire_all()
    assert db.query(FinanceMonthlyReport).filter_by(month=month, region_id=region, work_type="PAYROLL").count() == signoffs + 1

    # 3. Any other way out of approval (here a direct database change, as in a data reset) is caught by the worker's check.
    from backend.worker import check_payroll_signoffs
    db.get(WorkLog, log["id"]).status = "RETURNED_TO_PROVIDER"
    db.commit()
    assert check_payroll_signoffs(db) >= 1
    assert not cso_has_them()
    before = db.query(FinanceMonthlyReportWithdrawal).count()
    check_payroll_signoffs(db)  # already taken back: nothing more is added
    assert db.query(FinanceMonthlyReportWithdrawal).count() == before


def test_a_signed_month_stands_when_its_people_are_still_approved(api, db, empty_period, v22):
    rf = v22["finance"]
    for user in (rf, "csofin1"):
        all_cadres(db, user)
    log = approve_to_regional_finance(api, prepare(api, db, empty_period, v22, "hcp1", "PAYROLL"), rf)
    month, region = month_of(db, log["id"]), db.get(StaffAssignment, log["assignment_id"]).region_id
    report = api.get(f"/finance/monthly-report?month={month}&region_id={region}&work_type=PAYROLL", rf)
    api.post("/finance/monthly-report/approve", rf, {"month": month, "region_id": region, "work_type": "PAYROLL",
                                                      "review_confirmed": True, "expected_digest": report["digest"]})
    from backend.services.monthly_report_approval import withdraw_stale_payroll
    assert withdraw_stale_payroll(db, region_id=region, months={month}) == []
    db.rollback()
    assert api.get(f"/finance/monthly-report?month={month}&region_id={region}&work_type=PAYROLL", rf)["state"] == "APPROVED"
