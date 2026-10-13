"""Acceptance criteria 8–16 and 19: rules, routes A/B/C, isolation, budgets, tracker boundary, distinct statuses."""
import threading
from decimal import Decimal

from sqlalchemy import text

from .conftest import approved_log, category_id, make_period, submit_and_verify


def _ready(api, claim_id, preparer, approver):
    api.post(f"/claims/{claim_id}/actions/submit", preparer)
    claim = api.post(f"/claims/{claim_id}/actions/approve", approver)
    assert claim["status"] == "APPROVED", claim
    return api.post(f"/claims/{claim_id}/actions/mark_ready", preparer)


def _batch_for(api, user, route, claim_id):
    batches = api.post("/batches", user, {"route_code": route})
    return next(b for b in batches if claim_id in [c["id"] for c in api.get(f"/batches/{b['id']}", user)["claims"]])


# 8. Measures are never money without an active, approved rule
def test_no_payment_without_active_approved_rule(api, period, db):
    log = approved_log(api, "clerk1", period)
    cat = api.post("/admin/claim-categories", "fhifin1", {
        "name": "TEST data activity", "route_id": 1, "funding_source_id": 1, "payor_org_id": 1, "budget_owner": "PAYOR",
        "origin_channel": "FACILITY", "requires_work_log": True, "is_active": True})
    api.post("/budgets/lines", "fhifin1", {"code": "T-DATA", "name": "T", "organization_id": 1, "category_id": cat["id"], "period_id": period["id"], "allocated_amount": 100000})
    preview = api.post("/claims/preview", "fhifin1", {"work_log_id": log["id"], "category_id": cat["id"]})
    assert preview["amount"] == 0 and any("No active approved rate rule" in e for e in preview["exceptions"])

    rule = api.post("/admin/rate-rules", "fhifin1", {"category_id": cat["id"], "cadre_id": 2, "component_name": "Per HTS client", "unit_type": "PER_UNIT",
                                                     "measure_key": "hts_clients_registered", "rate_value": 100, "effective_start_date": "2020-01-01"})
    claim = api.post("/claims", "fhifin1", {"work_log_id": log["id"], "category_id": cat["id"]})
    assert claim["status"] == "VALIDATION_NEEDED" and claim["amount"] == 0  # pending rule is not used
    api.post(f"/admin/rate-rules/{rule['id']}/approve", "fhifin2", expect=403)  # finance cannot approve rates
    api.post(f"/admin/rate-rules/{rule['id']}/approve", "rpm1")
    claim = api.post(f"/claims/{claim['id']}/actions/revalidate", "fhifin1")
    assert claim["status"] == "DRAFT" and claim["amount"] == 2400  # 24 HTS clients x 100
    assert claim["components"][0]["units"] == 24


# 9. Route A is FHI360's; CSOs never touch it
def test_route_a_is_isolated_from_csos(api, period, db):
    log = approved_log(api, "chw1", period)
    claim = api.post("/claims", "fhifin1", {"work_log_id": log["id"], "category_id": category_id(db, "A")})
    assert (claim["route_code"], claim["payor_name"], claim["executor_name"]) == ("A", "FHI360", "FHI360")
    api.post(f"/claims/{claim['id']}/actions/approve", "fhifin1", expect=409)  # not submitted
    api.post(f"/claims/{claim['id']}/actions/submit", "fhifin1")
    api.post(f"/claims/{claim['id']}/actions/approve", "fhifin1", expect=403)  # maker cannot check
    api.post(f"/claims/{claim['id']}/actions/approve", "fhifin2")
    api.post(f"/claims/{claim['id']}/actions/mark_ready", "fhifin1")
    _batch_for(api, "fhifin1", "A", claim["id"])
    for cso in ("csofin1", "csofin3"):
        api.get(f"/claims/{claim['id']}", cso, expect=404)
        api.post(f"/claims/{claim['id']}/payments", cso, {"amount": 1, "payment_reference": "XX", "payment_date": "2023-01-01"}, expect=404)
    claim = api.post(f"/claims/{claim['id']}/payments", "fhifin1", {"amount": claim["amount"], "payment_reference": "FHI-1", "payment_date": "2023-01-02"})
    assert claim["payment_status"] == "PROOF_REQUIRED"


# 10. Route B: facility → FHI360 → CSO, traceable end to end
def test_route_b_full_trace(api, period, db):
    log = approved_log(api, "hcp1", period)
    claim = api.post("/claims", "fhifin1", {"work_log_id": log["id"], "category_id": category_id(db, "B")})
    assert (claim["route_code"], claim["payor_name"], claim["executor_name"]) == ("B", "FHI360", "DEMO CSO Iringa")
    assert claim["amount"] == 10000  # 2 entries x 2h x 2,500/h (DEMO rate)
    _ready(api, claim["id"], "fhifin1", "fhifin2")
    batch = _batch_for(api, "fhifin1", "B", claim["id"])
    api.get(f"/claims/{claim['id']}", "csofin1", expect=404)  # not visible to the CSO before handoff
    api.post(f"/batches/{batch['id']}/receive", "csofin1", expect=404)
    api.post(f"/batches/{batch['id']}/hand-off", "fhifin1")
    api.post(f"/batches/{batch['id']}/receive", "csofin3", expect=404)  # other CSO
    claim = api.get(f"/claims/{claim['id']}", "csofin1")
    assert claim["status"] == "HANDED_OFF" and claim["payment_status"] == "NOT_STARTED"
    api.post(f"/claims/{claim['id']}/payments", "csofin1", {"amount": 1, "payment_reference": "XX", "payment_date": "2023-01-01"}, expect=409)
    api.post(f"/batches/{batch['id']}/receive", "csofin1")
    api.post(f"/claims/{claim['id']}/payments", "fhifin1", {"amount": 1, "payment_reference": "XX", "payment_date": "2023-01-01"}, expect=403)
    claim = api.post(f"/claims/{claim['id']}/payments", "csofin1", {"amount": 4000, "payment_reference": "MPESA-1", "payment_date": "2023-01-03", "status": "PARTIAL"})
    assert claim["payment_status"] == "PARTIALLY_RECORDED"
    claim = api.post(f"/claims/{claim['id']}/payments", "csofin1", {"amount": 6000, "payment_reference": "MPESA-2", "payment_date": "2023-01-03"})
    assert claim["payment_status"] == "PROOF_REQUIRED"
    api.post(f"/claims/{claim['id']}/actions/confirm_paid", "csofin1", expect=422)  # no proof yet
    api.call("POST", f"/claims/{claim['id']}/proofs", "csofin1", files={"file": ("proof.pdf", b"%PDF-1.4 test", "application/pdf")})
    claim = api.get(f"/claims/{claim['id']}", "csofin1")
    assert claim["payment_status"] == "PROOF_REQUIRED"  # proof alone does not mean paid
    claim = api.post(f"/claims/{claim['id']}/actions/confirm_paid", "csofin1")
    assert claim["payment_status"] == "PAID"
    api.post(f"/claims/{claim['id']}/actions/reconcile", "csofin1", expect=403)
    claim = api.post(f"/claims/{claim['id']}/actions/reconcile", "fhifin1", {"comment": "Matched CSO statement"})
    assert claim["payment_status"] == "RECONCILED"
    trail = [a["action"] for a in claim["audit"]]
    for step in ("create", "submit", "approve", "mark_ready", "export", "hand_off", "cso_receive", "record_payment", "upload_proof", "confirm_paid", "reconcile"):
        assert step in trail, step
    proof = claim["proofs"][0]
    r = api.call("GET", f"/claims/{claim['id']}/proofs/{proof['id']}", "csofin1")
    assert r.content.startswith(b"%PDF")
    api.call("GET", f"/claims/{claim['id']}/proofs/{proof['id']}", "csofin3", expect=404)
    api.call("GET", f"/claims/{claim['id']}/proofs/{proof['id']}", "rpm1", expect=403)


# 11. Route C: community verifier + CSO review; HRH-enrolled providers keep their approvals
def test_route_c_community_claim(api, period, db):
    from backend.models import Staff

    chw = db.query(Staff).filter(Staff.verified_phone == "+255710000101").one()
    body = {"category_id": category_id(db, "C"), "staff_id": chw.id, "period_id": period["id"],
            "evidence_text": "Community PrEP outreach sessions", "declared_units": {"days": 4, "clients_followed_up": 10}}
    api.post("/claims", "csofin3", body, expect=404)  # assigned to another CSO: not even visible
    claim = api.post("/claims", "csofin1", body)
    assert claim["status"] == "PENDING_COMMUNITY_VERIFICATION" and claim["amount"] == 37000  # 4x8,000 + 10x500 (DEMO)
    api.post(f"/claims/{claim['id']}/actions/submit", "csofin1", expect=409)
    api.post(f"/claims/{claim['id']}/actions/verify_community", "supervisor1", expect=404)  # not visible
    claim = api.post(f"/claims/{claim['id']}/actions/verify_community", "verifier1")
    _ready(api, claim["id"], "csofin1", "csofin2")
    _batch_for(api, "csofin1", "C", claim["id"])
    claim = api.get(f"/claims/{claim['id']}", "csofin2")
    assert claim["payment_status"] == "PENDING" and "record_payment" in claim["payment_actions"]

    # A Route C claim based on an HRH work log still needs the full work-log approval chain.
    log = submit_and_verify(api, "chw1", period)
    api.post("/claims", "csofin1", {"category_id": category_id(db, "C"), "work_log_id": log["id"]}, expect=409)


# 12. CSO tenancy
def test_cso_cannot_see_another_csos_data(api, period, db):
    for path in ("/claims", "/batches", "/budgets/lines"):
        mine = api.get(path, "csofin3")
        assert all(row.get("executor_org_id", row.get("organization_id")) != 2 for row in mine), path
    staff_names = [s["legal_name"] for s in api.get("/staff", "csofin3")]
    assert staff_names == ["Daudi Mbwambo"]
    assert "Daudi Mbwambo" not in [s["legal_name"] for s in api.get("/staff", "csofin1")]


# 13. Missing configuration is an exception, never a guess
def test_missing_configuration_is_visible(api, period, db):
    log = approved_log(api, "hcp1", period)
    unrouted = api.post("/admin/claim-categories", "fhifin1", {"name": "TEST unrouted", "budget_owner": "PAYOR", "origin_channel": "FACILITY", "requires_work_log": True, "is_active": True})
    preview = api.post("/claims/preview", "fhifin1", {"work_log_id": log["id"], "category_id": unrouted["id"]})
    assert any("no payment route" in e for e in preview["exceptions"]) and any("funding source" in e for e in preview["exceptions"])
    log2 = approved_log(api, "chw1", period)
    other = api.post("/admin/claim-categories", "fhifin1", {"name": "TEST no budget", "route_id": 1, "funding_source_id": 1, "payor_org_id": 1,
                                                           "budget_owner": "PAYOR", "origin_channel": "FACILITY", "requires_work_log": True, "is_active": True})
    preview = api.post("/claims/preview", "fhifin1", {"work_log_id": log2["id"], "category_id": other["id"]})
    assert any("No budget line" in e for e in preview["exceptions"])


# 14. Budget control is transaction-safe; holds block release; no double counting
def test_budget_hold_reallocation_and_spend(api, db):
    period = make_period(api, db, {("DEMO-A-01", "FHI360"): 60000})  # each claim below is 40,000
    claims = []
    for provider in ("chw1", "clerk1"):
        log = approved_log(api, provider, period)
        claim = api.post("/claims", "fhifin1", {"work_log_id": log["id"], "category_id": category_id(db, "A")})
        api.post(f"/claims/{claim['id']}/actions/submit", "fhifin1")
        claims.append(claim)
    first = api.post(f"/claims/{claims[0]['id']}/actions/approve", "fhifin2")
    second = api.post(f"/claims/{claims[1]['id']}/actions/approve", "fhifin2")
    assert first["status"] == "APPROVED" and second["status"] == "HELD" and "short by" in second["exception_reason"]
    api.post(f"/claims/{second['id']}/actions/mark_ready", "fhifin1", expect=409)  # holds block payroll release
    a_line = next(l for l in api.get(f"/budgets/lines?period_id={period['id']}", "fhifin1") if l["code"] == "DEMO-A-01")
    assert (a_line["committed_amount"], a_line["available_amount"]) == (40000, 20000)

    donor = api.post("/budgets/lines", "fhifin1", {"code": "DEMO-A-SPARE", "name": "Spare", "organization_id": 1, "category_id": category_id(db, "A"),
                                                   "period_id": period["id"], "region_id": 2, "allocated_amount": 50000})
    api.post("/budgets/reallocate", "fhifin1", {"from_line_id": donor["id"], "to_line_id": a_line["id"], "amount": 20000, "reason": "Cover held claim"})
    assert api.post(f"/claims/{second['id']}/actions/release", "rpm1")["status"] == "APPROVED"

    api.post(f"/claims/{first['id']}/actions/mark_ready", "fhifin1")
    _batch_for(api, "fhifin1", "A", first["id"])
    api.post(f"/claims/{first['id']}/payments", "fhifin1", {"amount": first["amount"], "payment_reference": "FHI-9", "payment_date": "2023-02-01"})
    line = api.get(f"/budgets/lines/{a_line['id']}/ledger", "fhifin1")
    assert line["line"]["spent_amount"] == first["amount"]
    assert line["line"]["committed_amount"] == second["amount"]  # spent moved out of committed, not double counted
    assert [t["kind"] for t in line["transactions"]].count("SPEND") == 1


def test_concurrent_commitments_never_overspend(client, db):
    """Two sessions race to commit against a line that can afford only one."""
    from backend.db.session import SessionLocal
    from backend.models import BudgetLine
    from backend.services import budgets

    line = db.query(BudgetLine).filter(BudgetLine.code == "DEMO-C-01").first()
    db.execute(text("insert into budget_lines (code, name, source, organization_id, category_id, period_id, allocated_amount, committed_amount, spent_amount, currency, sync_status, created_at, updated_at) "
                    "values ('RACE', 'race', 'CSO', :o, :c, :p, 100, 0, 0, 'TZS', 'NOT_APPLICABLE', now(), now())"),
               {"o": line.organization_id, "c": line.category_id, "p": line.period_id})
    db.commit()
    race_id = db.execute(text("select id from budget_lines where code = 'RACE'")).scalar()
    barrier, results = threading.Barrier(2), []

    def worker():
        session = SessionLocal()
        barrier.wait()
        try:
            budgets.commit(session, race_id, Decimal(80), None, None)
            session.commit()
            results.append("ok")
        except budgets.InsufficientBudget:
            session.rollback()
            results.append("held")
        finally:
            session.close()

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == ["held", "ok"]
    assert db.execute(text("select committed_amount from budget_lines where id = :i"), {"i": race_id}).scalar() == 80


# 15. FHI360 tracker boundary (file-based; no live connection claimed)
def test_tracker_import_export_and_reconcile(api, period, db):
    csv_text = "code,name,category,period_start,region,allocated_amount,external_ref\n" \
               f"DEMO-A-01,DEMO FHI360 PnP,DEMO – PnP activity (Route A),{period['start_date']},,7000000,HQ-123\n" \
               f"BAD,Bad,Unknown category,{period['start_date']},,1,X\n"
    log = api.call("POST", "/budgets/tracker/import", "fhifin1", files={"file": ("tracker.csv", csv_text, "text/csv")})
    assert (log["sync_status"], log["success_count"], log["error_count"]) == ("PARTIAL", 1, 1)
    line = next(l for l in api.get(f"/budgets/lines?period_id={period['id']}", "fhifin1") if l["code"] == "DEMO-A-01")
    assert (line["allocated_amount"], line["sync_status"], line["external_ref"]) == (7000000, "IMPORTED", "HQ-123")
    r = api.call("POST", f"/budgets/tracker/export?period_id={period['id']}", "fhifin1")
    assert "DEMO-A-01" in r.text
    line = api.post(f"/budgets/lines/{line['id']}/reconcile", "fhifin1", {"external_ref": "HQ-123", "comment": "Matched HQ tracker"})
    assert line["sync_status"] == "RECONCILED"
    api.call("POST", "/budgets/tracker/import", "csofin1", files={"file": ("t.csv", csv_text, "text/csv")}, expect=403)


# 16. Distinct state dimensions
def test_approved_exported_handed_off_paid_are_distinct(api, period, db):
    log = approved_log(api, "chw1", period)
    assert log["status"] == "APPROVED" and log["claims"] == []  # work-log approval creates no payment
    claim = api.post("/claims", "fhifin1", {"work_log_id": log["id"], "category_id": category_id(db, "A")})
    claim = _ready(api, claim["id"], "fhifin1", "fhifin2")
    assert (claim["status"], claim["payment_status"]) == ("READY", "NOT_STARTED")
    _batch_for(api, "fhifin1", "A", claim["id"])
    claim = api.get(f"/claims/{claim['id']}", "fhifin1")
    assert (claim["status"], claim["payment_status"]) == ("EXPORTED", "PENDING")
    api.call("POST", f"/claims/{claim['id']}/proofs", "fhifin1", files={"file": ("p.png", b"<html><script>alert(1)</script>", "image/png")}, expect=415)
    api.call("POST", f"/claims/{claim['id']}/proofs", "fhifin1", files={"file": ("p.png", b"\x89PNG\r\n\x1a\n fake", "image/png")})
    assert api.get(f"/claims/{claim['id']}", "fhifin1")["payment_status"] == "PENDING"  # proof alone ≠ paid
    claim = api.post(f"/claims/{claim['id']}/payments", "fhifin1", {"amount": claim["amount"], "payment_reference": "FHI-77", "payment_date": "2023-03-01"})
    assert claim["payment_status"] == "PAID"  # payment action + proof
    api.call("POST", f"/claims/{claim['id']}/proofs", "fhifin1", files={"file": ("x.exe", b"MZ", "application/octet-stream")}, expect=415)


def test_duplicate_claims_are_prevented(api, period, db):
    log = approved_log(api, "clerk1", period)
    api.post("/claims", "fhifin1", {"work_log_id": log["id"], "category_id": category_id(db, "A")})
    api.post("/claims", "fhifin1", {"work_log_id": log["id"], "category_id": category_id(db, "A")}, expect=409)


# 19. Sensitive values
def test_sensitive_fields_are_restricted(api, db):
    from backend.models import Staff

    staff = db.query(Staff).filter(Staff.verified_phone == "+255710000103").one()
    assert "payment_account" not in api.get(f"/staff/{staff.id}", "rpm1")
    assert "•" in api.get(f"/staff/{staff.id}", "rpm1")["verified_phone"]
    assert api.get(f"/staff/{staff.id}", "fhifin1")["payment_account"]
    viewed = db.execute(text("select count(*) from audit_events where action = 'view_payment_details' and entity_id = :i"), {"i": str(staff.id)}).scalar()
    assert viewed >= 1
    me = api.get("/auth/me", "hcp1")
    assert "payment_account" not in me["staff"]
    outbox = api.get("/admin/sms-outbox", "oversight1")
    assert all("•" in m["destination_phone"] for m in outbox)


def test_staff_edits_are_validated(api, db):
    from backend.models import Staff

    staff = db.query(Staff).filter(Staff.verified_phone == "+255710000102").one()
    for changes, code in (({"verified_phone": "abc"}, 422), ({"cadre_id": 999}, 422), ({"status": "EXITED"}, 422),
                          ({"verified_phone": "+255710000101"}, 409), ({"payment_method": "CASH"}, 422)):
        api.call("PATCH", f"/staff/{staff.id}", "central1", json={"changes": changes, "reason": "test"}, expect=code)
    assert "payment_account" in api.get(f"/staff/{staff.id}", "central1")  # registering admins can check details
    r = api.call("PATCH", f"/staff/{staff.id}", "csofin1", json={"changes": {"salary_scale": "TGS-B", "occupation": "Data Clerk"}, "reason": "New contract"})
    assert r["applied"] and r["change_request_id"]  # occupation applied, salary scale needs HRH approval


def test_provider_sees_dev_code_and_no_payment_when_nothing_outstanding(api, period, db):
    log = submit_and_verify(api, "chw1", period)
    assert api.get(f"/worklogs/{log['id']}", "chw1")["dev_otp"] == log["otp"]["dev_otp"]
    assert api.get(f"/worklogs/{log['id']}", "supervisor1")["dev_otp"] is None
    api.post(f"/worklogs/{log['id']}/otp/confirm", "chw1", {"code": log["otp"]["dev_otp"]})
    api.post(f"/worklogs/{log['id']}/actions/endorse", "tofficer1")
    log = api.post(f"/worklogs/{log['id']}/actions/authorize", "rpm1")
    claim = api.post("/claims", "fhifin1", {"work_log_id": log["id"], "category_id": category_id(db, "A")})
    _ready(api, claim["id"], "fhifin1", "fhifin2")
    _batch_for(api, "fhifin1", "A", claim["id"])
    claim = api.post(f"/claims/{claim['id']}/payments", "fhifin1", {"amount": claim["amount"], "payment_reference": "FHI-5", "payment_date": "2023-04-01"})
    assert claim["payment_status"] == "PROOF_REQUIRED"
    assert "record_payment" not in claim["payment_actions"] and "upload_proof" in claim["payment_actions"]


def test_tracker_template_round_trips(api, period):
    r = api.call("GET", "/budgets/tracker/template", "fhifin1")
    assert "fhi360-tracker-import-template.csv" in r.headers["content-disposition"]
    lines = r.text.splitlines()
    assert lines[0] == "code,name,category,period_start,region,allocated_amount,external_ref"
    row = next(l for l in lines[1:] if ",DEMO – PnP activity (Route A)," in l and f",{period['start_date']}," in l)
    filled = row.split(",")
    filled[5], filled[6] = "4500000", "HQ-T1"
    blank = next(l for l in lines[1:] if l != row)
    log = api.call("POST", "/budgets/tracker/import", "fhifin1", files={"file": ("t.csv", "\n".join([lines[0], ",".join(filled), blank]), "text/csv")})
    assert (log["success_count"], log["error_count"]) == (1, 1)
    assert "allocated_amount is empty" in log["log_data"]["errors"][0]["error"]
    line = next(l for l in api.get(f"/budgets/lines?period_id={period['id']}", "fhifin1") if l["code"] == filled[0])
    assert (line["allocated_amount"], line["external_ref"]) == (4500000, "HQ-T1")
    api.call("GET", "/budgets/tracker/template", "csofin1", expect=403)
