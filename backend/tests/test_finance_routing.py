"""The dedicated routing API cannot bypass approval, assignment, scope or payment controls."""
import pytest

from .conftest import category_id
from .test_v22_finance import v22, priced_activity, entered_log, to_finance


def reviewed_log(api, db, period, v22, kind="SERVICES"):
    activity = priced_activity(api, v22, period, kind=kind)
    pending = to_finance(api, entered_log(api, period, activity))
    body = {"review_confirmed": True, "review_type": kind, "category_id": category_id(db, "A" if kind == "SERVICES" else "B")}
    return api.post(f"/worklogs/{pending['id']}/actions/finance_review", v22["finance"], body)


def channel_body(log):
    return {
        "claim_id": next(claim["id"] for claim in log["claims"] if claim["status"] == "PENDING_ROUTING"),
        "target_payor_id": log["finance_snapshot"]["payor_org_id"],
        "review_confirmed": True, "review_type": log["work_type"], "expected_version": log["version"],
    }


@pytest.mark.parametrize("kind,channel", [("SERVICES", "FHI360"), ("PAYROLL", "CSO")])
def test_assignment_queue_channel_and_immutable_audit(api, db, period, v22, kind, channel):
    from backend.models import AuditEvent, BudgetLine, PaymentClaim, User, WorkLogAudit
    log = reviewed_log(api, db, period, v22, kind)
    body = channel_body(log)
    prepared = db.get(PaymentClaim, body["claim_id"])
    assert prepared.status == "PENDING_ROUTING" and prepared.approved_by is None
    line = db.get(BudgetLine, prepared.budget_line_id)
    assert float(line.committed_amount) == 0
    queue = api.get(f"/finance/pending-routing?region_id={v22['region_id']}&work_type={kind}", v22["finance"])
    row = next(row for row in queue if row["work_log_id"] == log["id"])
    assert row["claim_id"] == prepared.id
    assert row["provider_name"] and row["cadre_name"] and row["region_name"]
    assert row["cadre_id"] == v22["cadre_id"] and row["region_id"] == v22["region_id"]
    assert row["facility_name"] or row["facility_id"] is None
    assert [owner["id"] for owner in row["eligible_payors"]] == [body["target_payor_id"]]
    assert row["eligible_payors"][0]["type"] == channel
    assert not api.get("/finance/pending-routing?region_id=999999", v22["finance"])
    assert {row["id"] for row in api.get("/finance/regions", v22["finance"])} == {v22["region_id"]}
    payors = api.get(f"/finance/payors?work_log_id={log['id']}", v22["finance"])
    assert payors["eligible_payors"] == row["eligible_payors"] and payors["routing_exception"] is None
    result = api.post("/finance/channel", v22["finance"], body)
    assert result["status"] == f"ROUTED_{channel}" and result["claim_status"] == "READY"
    assert result["payor_id"] == body["target_payor_id"] and result["channel"] == channel
    assert all(row["work_log_id"] != log["id"] for row in api.get("/finance/pending-routing", v22["finance"]))
    db.expire_all()
    assert float(line.committed_amount) == float(log["finance_snapshot"]["total"])
    assert prepared.payment_status == "NOT_STARTED"  # channeling is never payment
    actor = db.query(User).filter_by(username=v22["finance"]).one()
    event = db.query(WorkLogAudit).filter_by(work_log_id=log["id"], action="route_fhi360" if kind == "SERVICES" else "route_cso").one()
    assert event.actor_id == actor.id and event.timestamp is not None
    assert event.details["target_payor_id"] == body["target_payor_id"] and event.details["channeled_at"]
    global_event = db.query(AuditEvent).filter_by(entity_id=str(prepared.id), action="finance_channel").one()
    assert global_event.actor_id == actor.id and global_event.created_at is not None
    assert global_event.after["payor_id"] == body["target_payor_id"]
    api.post("/finance/channel", v22["finance"], body, expect=409)
    db.expire_all()
    assert float(line.committed_amount) == float(log["finance_snapshot"]["total"])


@pytest.mark.parametrize("kind", ["SERVICES", "PAYROLL"])
def test_wrong_payor_confirmation_and_stale_review_rejected(api, db, period, v22, kind):
    from backend.models import Organization, PaymentClaim
    log = reviewed_log(api, db, period, v22, kind)
    body = channel_body(log)
    wrong = db.query(Organization).filter(Organization.type == "CSO", Organization.id != body["target_payor_id"]).first()
    assert wrong
    api.post("/finance/channel", v22["finance"], {**body, "target_payor_id": wrong.id}, expect=422)
    api.post("/finance/channel", v22["finance"], {key: value for key, value in body.items() if key != "target_payor_id"}, expect=422)
    api.post("/finance/channel", v22["finance"], {**body, "review_confirmed": False}, expect=422)
    api.post("/finance/channel", v22["finance"], {**body, "review_type": "PAYROLL" if kind == "SERVICES" else "SERVICES"}, expect=422)
    api.post("/finance/channel", v22["finance"], {**body, "expected_version": log["version"] + 1}, expect=409)
    api.post("/finance/channel", "fhifin1", body, expect=403)
    # The original work-log endpoint must not silently restore auto-selection.
    action = "route_fhi360" if kind == "SERVICES" else "route_cso"
    api.post(f"/worklogs/{log['id']}/actions/{action}", v22["finance"],
             {"review_confirmed": True, "review_type": kind}, expect=422)
    db.expire_all()
    assert db.get(PaymentClaim, body["claim_id"]).status == "PENDING_ROUTING"


def test_cadre_scope_is_enforced_for_queue_choices_and_channel(api, db, period, v22):
    from backend.models import User, UserReviewCadre
    log = reviewed_log(api, db, period, v22)
    body = channel_body(log)
    api.get("/finance/pending-routing", "tofficer1", expect=403)
    actor = db.query(User).filter_by(username=v22["finance"]).one()
    db.query(UserReviewCadre).filter_by(user_id=actor.id).delete()
    db.commit()
    assert not api.get("/finance/pending-routing", v22["finance"])
    api.get(f"/finance/payors?work_log_id={log['id']}", v22["finance"], expect=404)
    api.post("/finance/channel", v22["finance"], body, expect=404)


def test_return_retires_only_pending_proposal_and_allows_new_review(api, db, period, v22):
    from backend.models import BudgetLine, PaymentClaim
    log = reviewed_log(api, db, period, v22)
    body = channel_body(log)
    returned = api.post(f"/worklogs/{log['id']}/actions/return", v22["finance"],
                        {"review_confirmed": True, "review_type": "SERVICES", "comment": "Check the aggregate totals"})
    db.expire_all()
    old = db.get(PaymentClaim, body["claim_id"])
    assert old.status == "CANCELLED" and old.calculation_snapshot
    assert float(db.get(BudgetLine, old.budget_line_id).committed_amount) == 0
    assert returned["finance_snapshot"] is None
    pending = to_finance(api, returned)
    reviewed = api.post(f"/worklogs/{log['id']}/actions/finance_review", v22["finance"],
                        {"review_confirmed": True, "review_type": "SERVICES", "category_id": category_id(db, "A")})
    assert channel_body(reviewed)["claim_id"] != old.id


def test_only_finance_reviewed_new_records_can_be_channeled(api, db, period, v22, monkeypatch):
    from backend.core import workflow_policy
    monkeypatch.setattr(workflow_policy, "NEW_RECORD_WORKFLOW_VERSION", 1)
    legacy = api.post("/worklogs", "chw1", {"period_id": period["id"]})
    assert all(row["work_log_id"] != legacy["id"] for row in api.get("/finance/pending-routing", v22["finance"]))
    api.get(f"/finance/payors?work_log_id={legacy['id']}", v22["finance"], expect=404)
    api.post("/finance/channel", v22["finance"], {
        "work_log_id": legacy["id"], "target_payor_id": 1, "review_confirmed": True, "review_type": "SERVICES",
    }, expect=404)
    monkeypatch.setattr(workflow_policy, "NEW_RECORD_WORKFLOW_VERSION", 2)
    log = api.post("/worklogs", "hcp1", {"period_id": period["id"], "work_type": "SERVICES"})
    api.post("/finance/channel", "admin", {
        "work_log_id": log["id"], "target_payor_id": 1, "review_confirmed": True, "review_type": "SERVICES",
    }, expect=409)
