"""End to end, as configured for the demo: provider → CTC In-Charge → technical officer → RPM → finance.

After RPM approval two claims are created automatically:
  - the monthly timesheet (SALARY, Route B): pays the staff record's monthly salary; FHI360 Finance approves, the CSO pays;
  - the services (SERVICES, Route A): priced per client with the facility's own rate; FHI360 Finance approves and pays.
One FHI360 Finance person can approve them alone: the RPM's approval is the first of the two decisions.
"""
from datetime import date, timedelta

from sqlalchemy import text

from .conftest import ENTRY
from .test_claims import _batch_for


def _queue_ids(api, user):
    return [w["id"] for w in api.get("/worklogs?queue=true", user)]


def _pay_with_proof(api, user, claim):
    claim = api.post(f"/claims/{claim['id']}/payments", user, {"amount": claim["amount"], "payment_reference": f"REF-{claim['id']}", "payment_date": "2023-06-30"})
    api.call("POST", f"/claims/{claim['id']}/proofs", user, files={"file": ("proof.pdf", b"%PDF-1.4 proof", "application/pdf")})
    return api.post(f"/claims/{claim['id']}/actions/confirm_paid", user)


def test_timesheet_and_services_reach_the_right_finance(api, period, db):
    from backend.models import Organization, Staff

    fhi360 = db.query(Organization).filter(Organization.type == "FHI360").first()
    base = {"funding_source_id": 1, "payor_org_id": fhi360.id, "budget_owner": "PAYOR", "origin_channel": "FACILITY", "requires_work_log": True, "is_active": True}
    salary_cat = api.post("/admin/claim-categories", "fhifin1", {**base, "name": "FLOW timesheet payroll", "form_type": "SALARY", "route_id": 2})
    services_cat = api.post("/admin/claim-categories", "fhifin1", {**base, "name": "FLOW services", "form_type": "SERVICES", "route_id": 1})
    try:
        for cat in (salary_cat, services_cat):
            api.post("/budgets/lines", "fhifin1", {"code": f"FLOW-{cat['id']}", "name": cat["name"], "organization_id": fhi360.id,
                                                   "category_id": cat["id"], "period_id": period["id"], "allocated_amount": 10_000_000})
        # Services: a national rate and a higher rate for this provider's facility; the facility rate wins.
        staff = db.query(Staff).filter(Staff.verified_phone == "+255710000101").one()
        facility_id = db.execute(text("select facility_id from staff_assignments where staff_id = :s and end_date is null"), {"s": staff.id}).scalar()
        for extra in ({}, {"facility_id": facility_id}):
            rule = api.post("/admin/rate-rules", "fhifin1", {"category_id": services_cat["id"], "component_name": "SNS testing", "unit_type": "PER_UNIT",
                                                             "measure_key": "svc_sns_testing", "rate_value": 1500 if extra else 1000,
                                                             "effective_start_date": "2020-01-01", **extra})
            api.post(f"/admin/rate-rules/{rule['id']}/approve", "rpm1")
        # The timesheet pays the monthly salary on the staff record, set through a change request (two admins).
        req = api.call("PATCH", f"/staff/{staff.id}", "central1", json={"changes": {"monthly_salary": 250000}, "reason": "Contract"})
        api.post(f"/staff/change-requests/{req['change_request_id']}/decide", "regadmin1", {"approve": True})

        # Provider fills a day with hours and services, then submits.
        log = api.post("/worklogs", "chw1", {"period_id": period["id"]})
        start = date.fromisoformat(period["start_date"])
        for d, sns in ((start, 2), (start + timedelta(days=1), 1)):
            entry = ENTRY["CHW"](d)
            log = api.put(f"/worklogs/{log['id']}/entries/{d}", "chw1", {**entry, "measures": {**entry["measures"], "svc_sns_testing": sns}})
        assert log["id"] not in _queue_ids(api, "supervisor1")
        api.post(f"/worklogs/{log['id']}/actions/submit", "chw1", {"attest": True})

        # Step 1: only the CTC In-Charge sees it.
        assert log["id"] in _queue_ids(api, "supervisor1")
        assert log["id"] not in _queue_ids(api, "tofficer1") and log["id"] not in _queue_ids(api, "rpm1")
        log = api.post(f"/worklogs/{log['id']}/actions/verify", "supervisor1", {"expected_version": log["version"]})
        if log["status"] == "PENDING_PROVIDER_OTP_CONFIRMATION":
            api.post(f"/worklogs/{log['id']}/otp/confirm", "chw1", {"code": log["otp"]["dev_otp"]})

        # Step 2: the technical officer for this cadre.
        assert log["id"] in _queue_ids(api, "tofficer1") and log["id"] not in _queue_ids(api, "supervisor1")
        api.post(f"/worklogs/{log['id']}/actions/endorse", "tofficer1", {})

        # Step 3: the RPM approves; nothing reaches finance before that.
        assert log["id"] in _queue_ids(api, "rpm1") and log["id"] not in _queue_ids(api, "tofficer1")
        assert not [c for c in api.get("/claims", "fhifin1") if c["work_log_id"] == log["id"]]
        api.post(f"/worklogs/{log['id']}/actions/authorize", "rpm1", {})

        # Step 4: two claims, both waiting for FHI360 Finance.
        claims = {c["category_id"]: c for c in api.get("/claims", "fhifin1") if c["work_log_id"] == log["id"]}
        timesheet, services = claims[salary_cat["id"]], claims[services_cat["id"]]
        assert (timesheet["route_code"], timesheet["status"], timesheet["amount"]) == ("B", "AWAITING_APPROVAL", 250000)
        assert (services["route_code"], services["status"], services["amount"]) == ("A", "AWAITING_APPROVAL", 4500)  # 3 clients x facility rate 1,500
        assert not [c for c in api.get("/claims", "csofin1") if c["work_log_id"] == log["id"]]  # the CSO sees nothing yet
        sent = {e for (e,) in db.execute(text("select event_name from sms_outbox where related_id in (:a, :b) and related_type = 'payment_claim'"),
                                          {"a": timesheet["id"], "b": services["id"]})}
        assert sent == {"TIMESHEET_CLAIM_CREATED", "SERVICE_CLAIM_CREATED"}

        # One FHI360 Finance person approves both (the RPM was the first decision).
        for claim in (timesheet, services):
            assert api.post(f"/claims/{claim['id']}/actions/approve", "fhifin1")["status"] == "APPROVED"
            api.post(f"/claims/{claim['id']}/actions/mark_ready", "fhifin1")

        # Timesheet: FHI360 hands the payroll to the CSO, which pays and confirms with proof.
        batch = _batch_for(api, "fhifin1", "B", timesheet["id"])
        api.post(f"/batches/{batch['id']}/hand-off", "fhifin1")
        api.post(f"/batches/{batch['id']}/receive", "csofin1")
        assert _pay_with_proof(api, "csofin1", timesheet)["payment_status"] == "PAID"

        # Services: FHI360 pays and confirms with proof; the CSO never sees them.
        _batch_for(api, "fhifin1", "A", services["id"])
        assert _pay_with_proof(api, "fhifin1", services)["payment_status"] == "PAID"
        api.get(f"/claims/{services['id']}", "csofin1", expect=404)
    finally:
        # Leave no extra SALARY/SERVICES categories behind: other tests create their own.
        db.execute(text("update claim_categories set is_active = false where id in (:a, :b)"), {"a": salary_cat["id"], "b": services_cat["id"]})
        db.commit()
