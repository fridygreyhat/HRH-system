"""Services (SNS testing, CART refill, ...): recorded on the daily work log, reviewed with it, then paid by FHI360."""
from datetime import date, timedelta

from sqlalchemy import text

from .conftest import ENTRY, approved_log

SEEDED = {"svc_sns_testing", "svc_index_testing", "svc_weekend_clinic", "svc_tb_outreach", "svc_cart_refill"}


def _active_keys(api, cadre_id):
    cadre = next(c for c in api.get("/admin/cadres", "chw1") if c["id"] == cadre_id)
    return {f["key"] for f in cadre["fields"] if f["is_active"]}


def test_admin_manages_services_per_cadre(api):
    services = {s["key"]: s for s in api.get("/admin/services", "chw1")}
    assert SEEDED <= set(services) and services["svc_sns_testing"]["cadre_ids"] == [1, 2, 3]

    body = {"key": "svc_test_vmmc", "label_en": "VMMC (clients)", "label_sw": "Tohara (wateja)", "cadre_ids": [3]}
    api.post("/admin/services", "fhifin1", body, expect=403)
    api.post("/admin/services", "central1", {**body, "cadre_ids": []}, expect=422)
    assert api.post("/admin/services", "central1", body)["cadre_ids"] == [3]
    api.post("/admin/services", "central1", body, expect=409)  # key taken
    assert "svc_test_vmmc" in _active_keys(api, 3) and "svc_test_vmmc" not in _active_keys(api, 1)

    moved = api.put("/admin/services/svc_test_vmmc", "central1", {**body, "label_en": "VMMC", "cadre_ids": [1]})
    assert moved["cadre_ids"] == [1] and moved["label_en"] == "VMMC"
    assert "svc_test_vmmc" in _active_keys(api, 1) and "svc_test_vmmc" not in _active_keys(api, 3)
    api.put("/admin/services/svc_test_vmmc", "central1", {**body, "key": "svc_other"}, expect=422)
    # Services are not edited one cadre at a time, and their keys cannot be reused as plain form fields.
    api.put("/admin/cadres/1/fields/svc_test_vmmc", "central1", {"key": "svc_test_vmmc", "label_en": "x"}, expect=409)
    api.post("/admin/cadres/2/fields", "central1", {"key": "svc_test_vmmc", "label_en": "x"}, expect=409)


def test_services_reach_fhi360_finance_after_rpm_approval(api, period, db):
    cat = api.post("/admin/claim-categories", "fhifin1", {
        "name": "TEST services (FHI360)", "form_type": "SERVICES", "route_id": 1, "funding_source_id": 1, "payor_org_id": 1,
        "budget_owner": "PAYOR", "origin_channel": "FACILITY", "requires_work_log": True, "is_active": True})
    api.post("/budgets/lines", "fhifin1", {"code": "T-SVC", "name": "Services", "organization_id": 1, "category_id": cat["id"],
                                          "period_id": period["id"], "allocated_amount": 1_000_000})
    for key, rate in (("svc_sns_testing", 1000), ("svc_cart_refill", 500), ("svc_index_testing", 700)):
        rule = api.post("/admin/rate-rules", "fhifin1", {"category_id": cat["id"], "component_name": key, "unit_type": "PER_UNIT",
                                                         "measure_key": key, "rate_value": rate, "effective_start_date": "2020-01-01"})
        api.post(f"/admin/rate-rules/{rule['id']}/approve", "rpm1")
    api.put("/admin/services/svc_index_testing", "central1", {"key": "svc_index_testing", "label_en": "Index testing (clients tested)", "cadre_ids": [3]})

    # The CHW records services on the same daily form as the timesheet, filling only what was done that day.
    log = api.post("/worklogs", "chw1", {"period_id": period["id"]})
    start = date.fromisoformat(period["start_date"])
    for d, services in ((start, {"svc_sns_testing": 3, "svc_cart_refill": 2}), (start + timedelta(days=1), {"svc_sns_testing": 1})):
        entry = ENTRY["CHW"](d)
        log = api.put(f"/worklogs/{log['id']}/entries/{d}", "chw1", {**entry, "measures": {**entry["measures"], **services}})
    api.put(f"/worklogs/{log['id']}/entries/{start}", "chw1", {"hours_worked": 2, "measures": {"svc_index_testing": 1}}, expect=422)  # not for CHW
    assert log["totals"]["measures"]["svc_sns_testing"] == 4

    api.post(f"/worklogs/{log['id']}/actions/submit", "chw1", {"attest": True})
    log = api.post(f"/worklogs/{log['id']}/actions/verify", "supervisor1", {"expected_version": log["version"]})
    api.post(f"/worklogs/{log['id']}/otp/confirm", "chw1", {"code": log["otp"]["dev_otp"]})
    api.post(f"/worklogs/{log['id']}/actions/endorse", "tofficer1", {})
    assert not [c for c in api.get("/claims", "fhifin1") if c["work_log_id"] == log["id"]]  # nothing before the RPM approves
    api.post(f"/worklogs/{log['id']}/actions/authorize", "rpm1", {})

    claims = [c for c in api.get("/claims", "fhifin1") if c["work_log_id"] == log["id"]]
    assert len(claims) == 1
    claim = api.get(f"/claims/{claims[0]['id']}", "fhifin1")
    assert (claim["route_code"], claim["payor_name"], claim["status"]) == ("A", "FHI360", "AWAITING_APPROVAL")
    assert claim["amount"] == 5000  # 4 SNS x 1,000 + 2 CART x 500; index testing is not on the CHW form
    assert {c["component_name"]: c["units"] for c in claim["components"]} == {"svc_cart_refill": 2, "svc_sns_testing": 4}
    assert claim["id"] in [c["id"] for c in api.get("/claims?form_type=SERVICES", "fhifin2")]  # Finance's "Services to pay" view
    assert claim["id"] not in [c["id"] for c in api.get("/claims?form_type=SALARY", "fhifin2")]
    api.get(f"/claims/{claim['id']}", "csofin1", expect=404)  # the CSO never sees service claims
    sms = db.execute(text("select count(*) from sms_outbox where event_name = 'SERVICE_CLAIM_CREATED' and related_id = :id"), {"id": claim["id"]}).scalar()
    assert sms >= 2  # every FHI360 Finance user

    # FHI360 Finance reviews and approves.
    # The RPM's approval was the first decision: one FHI360 Finance person approves (a single-person team can).
    assert api.post(f"/claims/{claim['id']}/actions/approve", "fhifin1")["status"] == "APPROVED"
    api.post(f"/worklogs/{log['id']}/actions/reopen", "rpm1", {"comment": "Recount"}, expect=409)  # a live claim blocks reopening

    # A work log without services creates no service claim.
    plain = approved_log(api, "clerk1", period)
    assert not [c for c in api.get("/claims", "fhifin1") if c["work_log_id"] == plain["id"]]
