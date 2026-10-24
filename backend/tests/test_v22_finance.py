"""New-record financial routing, immutable activity rates and legacy isolation."""
import uuid
from datetime import date, timedelta

import pytest

from .conftest import PASSWORD, category_id


@pytest.fixture
def v22(api, db, monkeypatch, legacy_workflow_default):
    from backend.core import workflow_policy
    from backend.core.roles import REGIONAL_FINANCE
    from backend.core.security import hash_password
    from backend.models import Role, Staff, StaffAssignment, User, UserRole, UserScope, UserReviewCadre

    monkeypatch.setattr(workflow_policy, "NEW_RECORD_WORKFLOW_VERSION", 2)
    staff = db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == "chw1").one()
    assignment = db.query(StaffAssignment).filter(StaffAssignment.staff_id == staff.id).first()
    name = "regional_finance_" + uuid.uuid4().hex[:10]
    user = User(username=name, full_name="Test Regional Finance", hashed_password=hash_password(PASSWORD),
                phone="+2557" + str(uuid.uuid4().int % 100000000).zfill(8), must_change_password=False)
    db.add(user)
    db.flush()
    role = db.query(Role).filter(Role.name == REGIONAL_FINANCE).one()
    db.add(UserRole(user_id=user.id, role_id=role.id))
    for username in (name, "rpm1", "fhifin1", "fhifin2", "csofin1", "csofin2"):
        actor = db.query(User).filter(User.username == username).one()
        if not db.query(UserReviewCadre).filter_by(user_id=actor.id, cadre_id=staff.cadre_id).first():
            db.add(UserReviewCadre(user_id=actor.id, cadre_id=staff.cadre_id))
        if not db.query(UserScope).filter_by(user_id=actor.id, region_id=assignment.region_id).first():
            db.add(UserScope(user_id=actor.id, region_id=assignment.region_id))
    db.commit()
    return {"finance": name, "staff_id": staff.id, "cadre_id": staff.cadre_id, "region_id": assignment.region_id}


def priced_activity(api, v22, period, kind="SERVICES", mode="SINGLE", rate=100):
    return api.post("/rates", "tofficer1", {
        "label_en": "Test priced activity", "label_sw": "Shughuli ya majaribio",
        "cadre_id": v22["cadre_id"], "region_id": v22["region_id"], "item_type": kind,
        "form_mode": mode, "rate_value": rate, "currency": "TZS",
        "unit_type": "PER_HOUR" if kind == "PAYROLL" else "PER_UNIT",
        "effective_start_date": period["start_date"],
        **({"billable_index": 0} if mode == "CASCADE" else {}),
    })


def entered_log(api, period, activity, day=None):
    log = api.post("/worklogs", "chw1", {"period_id": period["id"], "work_type": activity["item_type"]})
    values = {key: 3 for key in activity["fields"]}
    body = {"activity_key": activity["key"], "hours_worked": 2, "evidence_text": "Aggregate activity counts", "measures": values}
    return api.put(f"/worklogs/{log['id']}/entries/{day or period['start_date']}", "chw1", body)


def to_finance(api, log):
    body = {"review_confirmed": True, "review_type": log["work_type"]}
    log = api.post(f"/worklogs/{log['id']}/actions/submit", "chw1", {"attest": True})
    log = api.post(f"/worklogs/{log['id']}/actions/verify", "supervisor1", body)
    log = api.post(f"/worklogs/{log['id']}/otp/confirm", "chw1", {"code": log["otp"]["dev_otp"]})
    log = api.post(f"/worklogs/{log['id']}/actions/endorse", "tofficer1", body)
    return api.post(f"/worklogs/{log['id']}/actions/authorize", "rpm1", body)


def route_log(api, db, v22, log, route):
    assert api.get("/admin/claim-categories", v22["finance"])
    body = {"review_confirmed": True, "review_type": log["work_type"], "category_id": category_id(db, route)}
    reviewed = api.post(f"/worklogs/{log['id']}/actions/finance_review", v22["finance"], body)
    assert reviewed["status"] == "FINANCE_REVIEWED"
    body["target_payor_id"] = reviewed["finance_snapshot"]["payor_org_id"]
    channel = "fhi360" if log["work_type"] == "SERVICES" else "cso"
    wrong = "cso" if channel == "fhi360" else "fhi360"
    api.post(f"/worklogs/{log['id']}/actions/route_{wrong}", v22["finance"], body, expect=403)
    return api.post(f"/worklogs/{log['id']}/actions/route_{channel}", v22["finance"], body)


def test_services_finance_gate_routing_and_actual_payment(api, db, period, v22):
    activity = priced_activity(api, v22, period)
    log = entered_log(api, period, activity)
    assert log["workflow_version"] == 2 and log["work_type"] == "SERVICES"
    assert float(log["financial_preview"]["total"]) == 300
    log = to_finance(api, log)
    assert log["status"] == "PENDING_FINANCE_REVIEW" and not log["claims"]
    # Channel finance cannot bypass the Regional Finance gate.
    api.post(f"/worklogs/{log['id']}/actions/finance_review", "fhifin1",
             {"review_confirmed": True, "review_type": "SERVICES", "category_id": category_id(db, "A")}, expect=403)
    api.post(f"/worklogs/{log['id']}/actions/finance_review", v22["finance"], {}, expect=422)
    routed = route_log(api, db, v22, log, "A")
    assert routed["status"] == "ROUTED_FHI360" and routed["routed_channel"] == "FHI360"
    claim = api.get(f"/claims/{routed['claims'][0]['id']}", "fhifin1")
    assert claim["status"] == "READY" and claim["payment_status"] == "NOT_STARTED"
    assert claim["payor_name"] == "FHI360" and claim["executor_name"] == "FHI360"
    assert float(claim["amount"]) == 300
    api.get(f"/claims/{claim['id']}", "csofin1", expect=404)
    api.put("/admin/settings/payment_requires_proof", "admin", {"value": False, "reason": "Test actual paid transition"})
    try:
        paid = api.post(f"/claims/{claim['id']}/payments", "fhifin1", {
            "amount": 300, "payment_reference": "TEST-V22-SERVICE", "payment_date": period["start_date"],
        })
        assert paid["payment_status"] == "PAID"
        assert api.get(f"/worklogs/{log['id']}", "chw1")["status"] == "PAID"
        api.post(f"/claims/{claim['id']}/actions/cancel", "fhifin1", {"comment": "Must not cancel paid claim"}, expect=403)
    finally:
        api.put("/admin/settings/payment_requires_proof", "admin", {"value": True, "reason": "Restore proof requirement"})


def test_payroll_is_paid_by_cso_without_legacy_fhi_handoff(api, db, period, v22):
    activity = priced_activity(api, v22, period, kind="PAYROLL", rate=500)
    log = entered_log(api, period, activity)
    assert activity["hours_input"] and activity["fields"] == []
    routed = route_log(api, db, v22, to_finance(api, log), "B")
    assert routed["status"] == "ROUTED_CSO"
    claim = api.get(f"/claims/{routed['claims'][0]['id']}", "csofin1")
    assert claim["route_code"] == "B" and float(claim["amount"]) == 1000
    assert claim["payor_name"] == claim["executor_name"] and "CSO" in claim["payor_name"]
    api.get(f"/claims/{claim['id']}", "fhifin1", expect=404)
    partial = api.post(f"/claims/{claim['id']}/payments", "csofin1", {
        "amount": 500, "payment_reference": "TEST-V22-PAYROLL", "payment_date": period["start_date"], "status": "PARTIAL",
    })
    assert partial["payment_status"] == "PARTIALLY_RECORDED"
    assert api.get(f"/worklogs/{log['id']}", "chw1")["status"] == "ROUTED_CSO"


def test_activity_revisions_do_not_reprice_existing_entries(api, period, v22):
    activity = priced_activity(api, v22, period)
    log = entered_log(api, period, activity)
    revision = api.post(f"/rates/{activity['id']}/revise", "tofficer1", {"rate_value": 200, "effective_start_date": period["start_date"]})
    assert revision["id"] != activity["id"] and revision["supersedes_id"] == activity["id"]
    old = api.get(f"/worklogs/{log['id']}", "chw1")
    assert float(old["financial_preview"]["total"]) == 300
    assert float(old["entries"][0]["activity_snapshot"]["rate_value"]) == 100
    # An edit of an existing date retains the original snapshot.
    updated = api.put(f"/worklogs/{log['id']}/entries/{period['start_date']}", "chw1", {
        "activity_key": activity["key"], "hours_worked": 2, "evidence_text": "Corrected count",
        "measures": {activity["fields"][0]: 4},
    })
    assert float(updated["financial_preview"]["total"]) == 400
    new_day = str(date.fromisoformat(period["start_date"]) + timedelta(days=1))
    api.put(f"/worklogs/{log['id']}/entries/{new_day}", "chw1", {
        "activity_key": activity["key"], "hours_worked": 2, "evidence_text": "Old version forbidden",
        "measures": {activity["fields"][0]: 1},
    }, expect=422)


def test_queue_scope_type_and_cascade_definitions(api, db, period, v22):
    activity = priced_activity(api, v22, period, mode="CASCADE")
    log = entered_log(api, period, activity)
    # Typed records get independent queues and cannot mix service and payroll entries.
    payroll = priced_activity(api, v22, period, kind="PAYROLL")
    api.put(f"/worklogs/{log['id']}/entries/{period['start_date']}", "chw1", {
        "activity_key": payroll["key"], "hours_worked": 2, "evidence_text": "Wrong item type", "measures": {},
    }, expect=422)
    log = to_finance(api, log)
    staff = api.get("/staff", v22["finance"])
    from backend.models import Staff
    allowed_staff = {row.id for row in db.query(Staff).filter(Staff.cadre_id == v22["cadre_id"])}
    assert staff and all(row["id"] in allowed_staff for row in staff)
    assert any(row["id"] == log["id"] for row in api.get("/worklogs?queue=true&work_type=SERVICES", v22["finance"]))
    assert all(row["id"] != log["id"] for row in api.get("/worklogs?queue=true&work_type=PAYROLL", v22["finance"]))
    api.post(f"/worklogs/{log['id']}/actions/finance_review", v22["finance"],
             {"review_confirmed": True, "review_type": "PAYROLL", "category_id": category_id(db, "A")}, expect=422)
    from backend.models import User, UserReviewCadre
    actor = db.query(User).filter_by(username=v22["finance"]).one()
    db.query(UserReviewCadre).filter_by(user_id=actor.id).delete()
    db.commit()
    assert not api.get("/worklogs?queue=true", v22["finance"])
    api.get(f"/worklogs/{log['id']}", v22["finance"], expect=404)
    # Technical Officers cannot create rates for a region they do not own.
    api.post("/rates", "tofficer1", {
        "label_en": "Forbidden rate", "label_sw": "Kiwango", "cadre_id": v22["cadre_id"],
        "region_id": 999999, "item_type": "SERVICES", "form_mode": "SINGLE",
        "rate_value": 100, "unit_type": "PER_UNIT", "effective_start_date": period["start_date"],
    }, expect=403)


def test_unpriced_work_blocks_finance_and_manual_claim_bypass(api, db, period, v22):
    from .conftest import ENTRY
    log = api.post("/worklogs", "chw1", {"period_id": period["id"], "work_type": "SERVICES"})
    log = api.put(f"/worklogs/{log['id']}/entries/{period['start_date']}", "chw1", ENTRY["CHW"](None))
    log = to_finance(api, log)
    assert log["financial_preview"]["exceptions"]
    api.post(f"/worklogs/{log['id']}/actions/finance_review", v22["finance"], {
        "review_confirmed": True, "review_type": "SERVICES", "category_id": category_id(db, "A"),
    }, expect=422)
    api.post("/claims", "csofin1", {
        "staff_id": v22["staff_id"], "period_id": period["id"], "category_id": category_id(db, "C"),
        "declared_units": {"PER_DAY": 1}, "evidence_text": "Standalone claims cannot bypass the new finance gate",
    }, expect=409)


def test_budget_hold_release_reuses_one_claim_and_one_commitment(api, db, period, v22):
    from backend.models import BudgetLine, PaymentClaim
    activity = priced_activity(api, v22, period)
    log = to_finance(api, entered_log(api, period, activity))
    line = db.query(BudgetLine).filter_by(category_id=category_id(db, "A"), period_id=period["id"]).one()
    allocation = line.allocated_amount
    line.allocated_amount = 0
    db.commit()
    held = route_log(api, db, v22, log, "A")
    assert held["status"] == "BUDGET_HOLD" and held["claims"][0]["status"] == "BUDGET_HOLD"
    claim_id = held["claims"][0]["id"]
    db.expire_all()
    line.allocated_amount = allocation
    db.commit()
    body = {"review_confirmed": True, "review_type": "SERVICES", "comment": "Budget allocation restored"}
    released = api.post(f"/worklogs/{log['id']}/actions/release", v22["finance"], body)
    assert released["status"] == "ROUTED_FHI360" and released["claims"][0]["id"] == claim_id
    db.expire_all()
    assert db.query(PaymentClaim).filter_by(work_log_id=log["id"]).count() == 1
    assert float(line.committed_amount) == 300


def test_client_cannot_select_legacy_pipeline_and_old_logs_stay_legacy(api, period, v22, monkeypatch):
    from backend.core import workflow_policy
    # A historical record family remains in its original pipeline.
    monkeypatch.setattr(workflow_policy, "NEW_RECORD_WORKFLOW_VERSION", 1)
    old = api.post("/worklogs", "chw1", {"period_id": period["id"]})
    assert old["workflow_version"] == 1 and old["work_type"] == "LEGACY"
    monkeypatch.setattr(workflow_policy, "NEW_RECORD_WORKFLOW_VERSION", 2)
    api.post("/worklogs", "chw1", {"period_id": period["id"], "work_type": "PAYROLL"}, expect=409)
    unchanged = api.get(f"/worklogs/{old['id']}", "chw1")
    assert unchanged["status"] == old["status"] and unchanged["finance_snapshot"] is None
    new = api.post("/worklogs", "hcp1", {"period_id": period["id"], "work_type": "SERVICES", "workflow_version": 1})
    assert new["workflow_version"] == 2 and new["work_type"] == "SERVICES"


def test_billable_indicator_is_explicit_and_future_revisions_keep_current_rates(api, period, v22):
    payload = {
        "label_en": "Explicit billing basis", "label_sw": "Kiwango kilichochaguliwa",
        "cadre_id": v22["cadre_id"], "region_id": v22["region_id"], "item_type": "SERVICES",
        "form_mode": "CASCADE", "rate_value": 100, "unit_type": "PER_UNIT",
        "effective_start_date": period["start_date"],
    }
    api.post("/rates", "tofficer1", payload, expect=422)
    activity = api.post("/rates", "tofficer1", {**payload, "billable_index": 1})
    assert activity["billable_field"] == activity["fields"][1]
    log = api.post("/worklogs", "chw1", {"period_id": period["id"], "work_type": "SERVICES"})
    values = dict(zip(activity["fields"], [5, 3, 2, 1]))
    body = {"activity_key": activity["key"], "hours_worked": 2, "evidence_text": "Aggregate cascade", "measures": values}
    first = api.put(f"/worklogs/{log['id']}/entries/{period['start_date']}", "chw1", body)
    assert float(first["financial_preview"]["total"]) == 300  # selected reached count, not linkage count
    start = date.fromisoformat(period["start_date"])
    effective = str(start + timedelta(days=2))
    revision = api.post(f"/rates/{activity['id']}/revise", "tofficer1", {"rate_value": 200, "effective_start_date": effective})
    # A scheduled new rate does not retire the old price a day too early.
    api.put(f"/worklogs/{log['id']}/entries/{start + timedelta(days=1)}", "chw1", body)
    api.put(f"/worklogs/{log['id']}/entries/{effective}", "chw1", body, expect=422)
    newest = api.put(f"/worklogs/{log['id']}/entries/{effective}", "chw1", {**body, "activity_key": revision["key"]})
    assert float(newest["financial_preview"]["total"]) == 1200
