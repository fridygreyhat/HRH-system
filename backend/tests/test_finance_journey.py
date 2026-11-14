"""The two payment paths end to end, and what each Finance role sees at every step.

Services: CTC -> Technical -> RM -> Regional Finance (timesheet, then payment) -> routed to FHI360 -> Central Finance
approves -> payment form -> PRF -> proof of payment -> paid. The CSO never sees it.
Payroll: CTC -> Technical -> RM approves -> Regional Finance signs the region's monthly Payroll report -> the CSO gets the
salary timesheets and the payment form, and pays to the bank. No claim; Central Finance never sees the salaries.
"""
import uuid
from decimal import Decimal

from backend.core.period_dates import pay_month_of
from backend.models import FinanceMonthlyReport, PaymentClaim, StaffAssignment, WorkLog
from .conftest import category_id
from .monthly_budget_setup import ensure_monthly_budgets
from .test_approval_finance_visibility import approve_to_regional_finance, prepare
from .test_ctc_facility_approval import no_provider_sms
from .test_finance_monthly_reports import all_cadres
from .test_payment_requests import pay, prf
from .test_salary_timesheets import bearer, provider_details
from .test_v22_finance import v22


def month_of(db, log_id):
    from backend.models import WorkLogEntry
    return pay_month_of(db.query(WorkLogEntry.entry_date).filter_by(work_log_id=log_id).order_by(WorkLogEntry.entry_date).first()[0])


def test_services_go_from_regional_finance_to_central_finance_and_are_paid(api, db, period, v22, no_provider_sms):
    rf = v22["finance"]
    for user in (rf, "fhifin1", "csofin1"):
        all_cadres(db, user)
    log = approve_to_regional_finance(api, prepare(api, db, period, v22, "chw1", "SERVICES"), rf)
    month = month_of(db, log["id"])

    # 1. Regional Finance: the timesheet first, then the payment, then the route. Nothing is payable yet.
    row = next(r for r in api.get("/finance/pending-routing?work_type=SERVICES", rf) if r["work_log_id"] == log["id"])
    assert row["next_action"] == "REVIEW_TIMESHEET"
    api.post("/finance/channel", rf, {"work_log_id": log["id"], "target_payor_id": 1, "review_confirmed": True,
                                      "review_type": "SERVICES"}, expect=409)  # cannot route before the reviews
    reviewed = api.post(f"/worklogs/{log['id']}/actions/finance_review", rf,
                        {"review_confirmed": True, "review_type": "SERVICES", "category_id": category_id(db, "A")})
    assert reviewed["status"] == "FINANCE_REVIEWED" and reviewed["finance_timesheet_approved_at"]
    ensure_monthly_budgets(db, log["id"], rf)
    payors = api.get(f"/finance/payors?work_log_id={log['id']}", rf)["eligible_payors"]
    assert [p["type"] for p in payors] == ["FHI360"]  # Services can only go to FHI360, never to a CSO
    routed = api.post("/finance/channel", rf, {
        "work_log_id": log["id"], "target_payor_id": payors[0]["id"], "review_confirmed": True, "review_type": "SERVICES",
        "expected_version": reviewed["version"], "central_reviewer_id": v22["central_reviewer_id"]})
    assert routed["status"] == "ROUTED_FHI360" and routed["claim_status"] == "PENDING_CENTRAL_REVIEW"
    claim_id = routed["claim_id"]

    # 2. The CSO never sees a Services claim or the Services payment form.
    assert claim_id not in {c["id"] for c in api.get("/claims", "csofin1")}
    api.get(f"/claims/{claim_id}", "csofin1", expect=404)
    api.get(f"/finance/services-payment-form?month={month}", "csofin1", expect=403)

    # 3. Central Finance: assigned to the named reviewer; not on the payment form until approved.
    assert any(c["id"] == claim_id and c["central_reviewer_id"] == v22["central_reviewer_id"] for c in api.get("/claims", "fhifin1"))
    form = api.get(f"/finance/services-payment-form?month={month}", "fhifin1")
    assert claim_id not in {r["claim_id"] for r in form["rows"]} and form["awaiting_central_review"]["claims"] >= 1
    amount = api.get(f"/claims/{claim_id}", "fhifin1")["amount"]
    approved = api.post(f"/claims/{claim_id}/actions/central_approve", "fhifin1", {"review_confirmed": True, "expected_amount": amount})
    assert approved["status"] == "READY"
    form = api.get(f"/finance/services-payment-form?month={month}", "fhifin1")
    line = next(r for r in form["rows"] if r["claim_id"] == claim_id)
    assert Decimal(line["total"]) == Decimal(str(amount)) and line["mobile"]

    # 4. Payment form -> PRF -> proof of payment -> paid.
    download = api.client.get(f"/finance/services-payment-report/export?month={month}&format=pdf", headers=bearer(api, "fhifin1"))
    assert download.status_code == 200 and download.content.startswith(b"%PDF")
    recorded = prf(api, int(download.headers["x-download-id"]), "PRF-JOURNEY-" + uuid.uuid4().hex[:6])
    paid = pay(api, recorded["id"])
    assert claim_id in paid["paid_claim_ids"]
    db.expire_all()
    assert db.get(PaymentClaim, claim_id).payment_status == "PAID"
    assert db.get(WorkLog, log["id"]).status == "PAID"  # the timesheet shows Paid too


def test_payroll_goes_from_rm_to_the_regional_finance_report_and_on_to_the_cso(api, db, period, v22, no_provider_sms):
    rf = v22["finance"]
    for user in (rf, "fhifin1", "csofin1"):
        all_cadres(db, user)
    log = approve_to_regional_finance(api, prepare(api, db, period, v22, "chw1", "PAYROLL"), rf)
    month = month_of(db, log["id"])
    placement = db.get(StaffAssignment, log["assignment_id"])
    region, cso = placement.region_id, placement.organization_id
    query = f"cso_id={cso}&month={month}"

    # 1. RM's approval ends the timesheet's own steps: no claim, nothing for Regional Finance to route.
    assert log["status"] == "APPROVED" and log["claims"] == []
    assert log["id"] not in {r["work_log_id"] for r in api.get("/finance/pending-routing", rf)}
    api.post("/finance/channel", rf, {"work_log_id": log["id"], "target_payor_id": cso, "review_confirmed": True,
                                      "review_type": "PAYROLL"}, expect=409)
    # Nor can Finance turn it into a claim by hand: preview and create both refuse, so no amount is ever shown.
    for user in ("csofin1", "fhifin1"):
        for path in ("/claims/preview", "/claims"):
            refused = api.client.post(path, headers=bearer(api, user), json={"work_log_id": log["id"], "category_id": category_id(db, "B")})
            # Refused either way: not visible to this role (404), or only Regional Finance's routing makes claims (409).
            assert refused.status_code in (404, 409) and "amount" not in refused.json()

    # 2. Until Regional Finance signs the region's Payroll report, the CSO has nothing to pay from.
    report = api.get(f"/finance/monthly-report?month={month}&region_id={region}&work_type=PAYROLL", rf)
    assert report["state"] == "NOT_APPROVED" and report["can_approve"]
    assert log["staff_id"] in {p["staff_id"] for p in report["report"]["providers"]}
    signed_before = api.get(f"/cso-finance/salary-timesheets?{query}", "csofin1")
    assert log["staff_id"] not in {p["staff_id"] for p in signed_before["providers"]}
    assert any(r["id"] == region and not r["signed"] for r in signed_before["regions"])

    # The CSO is told the month is waiting for Regional Finance (counts only, no names yet).
    def cso_status():
        from datetime import timedelta
        from backend.core.period_dates import pay_month_range
        from backend.core.security import load_current_user
        from backend.models import User
        from backend.services import monthly_report_approval as reports
        db.expire_all()
        cso_user = load_current_user(db, db.query(User).filter_by(username="csofin1").one())
        after = pay_month_range(month)[1] + timedelta(days=1)
        return next(i for i in reports.cso_payroll_status(db, cso_user, after) if i["region_id"] == region and i["month"] == month)
    waiting = cso_status()
    assert waiting["state"] == "WAITING" and waiting["approved_providers"] >= 1 and waiting["signed_providers"] == 0
    assert isinstance(api.get("/cso-finance/payroll-status", "csofin1"), list)
    api.get("/cso-finance/payroll-status", rf, expect=403)

    # Signing Services does not send the Payroll: they are separate sign-offs (the demo's mistake).
    services = api.get(f"/finance/monthly-report?month={month}&region_id={region}&work_type=SERVICES", rf)
    if services["report"]["providers"]:
        api.post("/finance/monthly-report/approve", rf, {"month": month, "region_id": region, "work_type": "SERVICES",
                                                          "review_confirmed": True, "expected_digest": services["digest"]})
        assert log["staff_id"] not in {p["staff_id"] for p in api.get(f"/cso-finance/salary-timesheets?{query}", "csofin1")["providers"]}

    # 3. Regional Finance signs the Payroll report.
    api.post("/finance/monthly-report/approve", rf, {"month": month, "region_id": region, "work_type": "PAYROLL",
                                                      "review_confirmed": True, "expected_digest": report["digest"]})
    assert db.query(FinanceMonthlyReport).filter_by(month=month, region_id=region, work_type="PAYROLL").count() == 1
    received = cso_status()
    assert received["state"] == "SIGNED" and received["signed_providers"] >= 1 and received["approved_by_name"]

    # 4. The CSO now has the provider in its salary timesheets and payment form, with the salary and bank details.
    state = {"staff_id": log["staff_id"], "scale": "JOURNEY-" + uuid.uuid4().hex[:6]}
    with provider_details(db, state):
        api.call("PUT", "/salary-amounts", "fhifin1", {"scale": state["scale"], "start_month": month, "monthly_amount": "700000.00"})
        timesheets = api.get(f"/cso-finance/salary-timesheets?{query}", "csofin1")
        person = next(p for p in timesheets["providers"] if p["staff_id"] == log["staff_id"])
        assert Decimal(person["monthly_salary"]) == 700000
        form = api.get(f"/cso-finance/payment-form?{query}", "csofin1")
        row = next(r for r in form["rows"] if Decimal(r["total"] or 0) == 700000)
        assert row["bank_name"] == "NMB" and row["bank_account_number"].endswith("6789")
        exported = api.client.get(f"/cso-finance/payment-form/export?{query}&format=xlsx", headers=bearer(api, "csofin1"))
        assert exported.status_code == 200

        # 5. Salaries stay with the CSO: Central Finance and Regional Finance cannot open the CSO's files.
        for user in ("fhifin1", rf):
            api.get(f"/cso-finance/payment-form?{query}", user, expect=403)
            api.get(f"/cso-finance/salary-timesheets?{query}", user, expect=403)
        services_form = api.client.get(f"/finance/services-payment-form?month={month}&include_prf=true", headers=bearer(api, "fhifin1"))
        assert services_form.status_code in (200, 404)
        if services_form.status_code == 200:
            assert log["staff_id"] not in {r.get("staff_id") for r in services_form.json()["rows"]}
    assert not db.query(PaymentClaim).filter_by(work_log_id=log["id"]).count()  # payroll is never a payment claim
