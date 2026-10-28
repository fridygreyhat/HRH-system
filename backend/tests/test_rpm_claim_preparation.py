"""RPM regional authority and immediate, non-payable claim preparation."""
import pytest

from .conftest import category_id
from .test_v22_finance import v22, priced_activity, entered_log, to_rpm, to_finance, route_log


def remove_rpm_cadre_limits(db):
    from backend.models import User, UserReviewCadre
    user = db.query(User).filter_by(username="rpm1").one()
    db.query(UserReviewCadre).filter_by(user_id=user.id).delete()
    db.commit()
    return user.id


@pytest.mark.parametrize("provider", ["chw1", "clerk1", "hcp1"])
def test_rpm_reviews_all_regional_cadres_without_cadre_grants(api, db, period, v22, provider):
    from backend.models import Staff, User, SMSOutbox
    actor_id = remove_rpm_cadre_limits(db)
    staff = db.query(Staff).join(User, Staff.user_id == User.id).filter(User.username == provider).one()
    activity = priced_activity(api, {**v22, "cadre_id": staff.cadre_id}, period)
    log = api.post("/worklogs", provider, {"period_id": period["id"], "work_type": "SERVICES"})
    log = api.put(f"/worklogs/{log['id']}/entries/{period['start_date']}", provider, {
        "activity_key": activity["key"], "hours_worked": 2,
        **({"start_time": "08:00", "end_time": "10:00"} if provider != "chw1" else {}),
        "evidence_text": "Verified aggregate demo counts", "measures": {k: 3 for k in activity["fields"]},
    })
    body = {"review_confirmed": True, "review_type": "SERVICES"}
    log = api.post(f"/worklogs/{log['id']}/actions/submit", provider, {"attest": True})
    log = api.post(f"/worklogs/{log['id']}/actions/verify", "supervisor1", body)
    log = api.post(f"/worklogs/{log['id']}/otp/confirm", provider, {"code": log["otp"]["dev_otp"]})
    log = api.post(f"/worklogs/{log['id']}/actions/endorse", "tofficer1", body)
    assert not log["claims"]
    assert any(x["id"] == log["id"] for x in api.get("/worklogs?queue=true", "rpm1"))
    assert db.query(SMSOutbox).filter_by(user_id=actor_id, event_name="WORKLOG_ENDORSED", related_id=log["id"]).count() == 1
    api.get(f"/worklogs/{log['id']}", "rpm2", expect=404)
    api.post(f"/worklogs/{log['id']}/actions/authorize", "rpm2", body, expect=404)
    authorized = api.post(f"/worklogs/{log['id']}/actions/authorize", "rpm1", body)
    assert authorized["status"] == "PENDING_FINANCE_REVIEW"
    assert authorized["approved_at"]
    assert authorized["claims"][0]["status"] == "PENDING_FINANCE_REVIEW"
    claim = api.get(f"/claims/{authorized['claims'][0]['id']}", "rpm1")
    assert claim["category_id"] is None and claim["category_name"] is None
    assert float(claim["amount"]) == 300
    assert not claim["available_actions"] and not claim["payment_actions"]


def test_rpm_claim_is_snapshotted_not_routed_and_reused_by_finance(api, db, period, v22):
    from backend.models import PaymentClaim, ClaimComponent, ClaimAudit, BudgetLine
    remove_rpm_cadre_limits(db)
    activity = priced_activity(api, v22, period)
    log = to_rpm(api, entered_log(api, period, activity))
    api.post(f"/rates/{activity['id']}/revise", "tofficer1",
             {"rate_value": 900, "effective_start_date": period["start_date"]})
    log = api.post(f"/worklogs/{log['id']}/actions/authorize", "rpm1",
                   {"review_confirmed": True, "review_type": "SERVICES"})
    cid = log["claims"][0]["id"]
    claim = api.get(f"/claims/{cid}", "rpm1")
    assert float(claim["amount"]) == 300
    assert claim["payor_org_id"] is None and claim["budget_line_id"] is None
    assert claim["approved_by"] is None and claim["payment_status"] == "NOT_STARTED"
    assert claim["calculation_snapshot"]["operationally_approved_by"]
    assert len(claim["components"]) == 1 and float(claim["components"][0]["rate"]) == 100
    assert db.query(ClaimAudit).filter_by(claim_id=cid, action="rpm_prepare").count() == 1
    # Batch export must exclude this claim, even if other scenarios have ready
    # claims. Roll the export back so this shared acceptance DB is unchanged.
    from fastapi import HTTPException
    from backend.core.security import load_current_user
    from backend.models import User
    from backend.services.batches import create_batches
    savepoint = db.begin_nested()
    try:
        finance = db.query(User).filter_by(username="fhifin1").one()
        try:
            exported = create_batches(db, load_current_user(db, finance), "A")
            assert all(line["claim_id"] != cid for batch in exported for line in batch.export_snapshot["lines"])
        except HTTPException as exc:
            assert exc.status_code == 409
    finally:
        savepoint.rollback()
    # Neither the RPM nor downstream finance can skip the finance gate.
    api.post(f"/worklogs/{log['id']}/actions/authorize", "rpm1",
             {"review_confirmed": True, "review_type": "SERVICES"}, expect=403)
    api.post(f"/claims/{cid}/payments", "fhifin1",
             {"amount": 300, "payment_reference": "MUST-NOT-PAY", "payment_date": period["start_date"]}, expect=403)
    api.post("/finance/channel", v22["finance"], {
        "claim_id": cid, "target_payor_id": 1, "review_confirmed": True, "review_type": "SERVICES",
    }, expect=409)
    line = db.query(BudgetLine).filter_by(category_id=category_id(db, "A"), period_id=period["id"]).one()
    before = line.committed_amount
    reviewed = api.post(f"/worklogs/{log['id']}/actions/finance_review", v22["finance"], {
        "review_confirmed": True, "review_type": "SERVICES", "category_id": category_id(db, "A"),
    })
    assert reviewed["claims"][0]["id"] == cid and reviewed["claims"][0]["status"] == "PENDING_ROUTING"
    db.expire_all()
    assert line.committed_amount == before
    assert db.query(ClaimComponent).filter_by(claim_id=cid).count() == 1
    api.post("/finance/channel", v22["finance"], {
        "claim_id": cid, "target_payor_id": reviewed["finance_snapshot"]["payor_org_id"],
        "review_confirmed": True, "review_type": "SERVICES",
    })
    db.expire_all()
    assert db.query(PaymentClaim).filter_by(work_log_id=log["id"]).count() == 1
    assert db.get(PaymentClaim, cid).status == "READY"
    assert line.committed_amount == before + 300


@pytest.mark.parametrize("action", ["return", "reject"])
def test_finance_retires_unreviewed_liability(api, db, period, v22, action):
    from backend.models import PaymentClaim
    log = to_finance(api, entered_log(api, period, priced_activity(api, v22, period)))
    cid = log["claims"][0]["id"]
    result = api.post(f"/worklogs/{log['id']}/actions/{action}", v22["finance"], {
        "review_confirmed": True, "review_type": "SERVICES", "comment": "Work needs correction",
    })
    db.expire_all()
    assert db.get(PaymentClaim, cid).status == "CANCELLED"
    assert db.get(PaymentClaim, cid).calculation_snapshot
    if action == "return":
        resubmitted = to_finance(api, result)
        live = [c for c in resubmitted["claims"] if c["status"] != "CANCELLED"]
        assert len(live) == 1 and live[0]["id"] != cid


def test_rpm_role_does_not_expand_finance_or_technical_cadres(api, db, period, v22):
    from backend.core.roles import RPM
    from backend.models import Role, User, UserRole, UserReviewCadre
    # A finance user also holding RPM can approve regional work, but cannot
    # use that broad operational authority to route out-of-cadre finance.
    actor = db.query(User).filter_by(username=v22["finance"]).one()
    db.add(UserRole(user_id=actor.id, role_id=db.query(Role).filter_by(name=RPM).one().id))
    db.query(UserReviewCadre).filter_by(user_id=actor.id).delete()
    db.commit()
    log = to_rpm(api, entered_log(api, period, priced_activity(api, v22, period)))
    pending = api.post(f"/worklogs/{log['id']}/actions/authorize", v22["finance"],
                       {"review_confirmed": True, "review_type": "SERVICES"})
    assert pending["status"] == "PENDING_FINANCE_REVIEW"
    api.post(f"/worklogs/{log['id']}/actions/finance_review", v22["finance"], {
        "review_confirmed": True, "review_type": "SERVICES", "category_id": category_id(db, "A"),
    }, expect=403)


def test_rpm_role_does_not_bypass_channel_payment_or_export_scope(api, db, period, v22):
    from backend.core.roles import RPM
    from backend.models import Role, User, UserRole, UserReviewCadre
    routed = route_log(api, db, v22,
                       to_finance(api, entered_log(api, period, priced_activity(api, v22, period))), "A")
    actor = db.query(User).filter_by(username="fhifin1").one()
    actor_id = actor.id
    rpm_role_id = db.query(Role).filter_by(name=RPM).one().id
    original_cadres = [c.cadre_id for c in db.query(UserReviewCadre).filter_by(user_id=actor_id)]
    db.add(UserRole(user_id=actor_id, role_id=rpm_role_id))
    db.query(UserReviewCadre).filter_by(user_id=actor.id).delete()
    db.commit()
    try:
        cid = routed["claims"][0]["id"]
        # RPM can view regional claims, but a separate finance action still needs
        # its own cadre scope. No money or export is allowed under RPM authority.
        claim = api.get(f"/claims/{cid}", "fhifin1")
        assert "record_payment" not in claim["payment_actions"]
        api.post(f"/claims/{cid}/payments", "fhifin1", {
            "amount": 300, "payment_reference": "NO-RPM-PAYMENT", "payment_date": period["start_date"],
        }, expect=409)
        api.post("/batches", "fhifin1", {"route_code": "A"}, expect=409)
    finally:
        # Acceptance tests share fixtures: a temporary extra role must never
        # leak into later authorization tests, even if an assertion fails.
        db.rollback()
        db.query(UserRole).filter_by(user_id=actor_id, role_id=rpm_role_id).delete()
        for cadre_id in original_cadres:
            db.add(UserReviewCadre(user_id=actor_id, cadre_id=cadre_id))
        db.commit()
