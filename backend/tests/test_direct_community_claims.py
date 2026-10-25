"""Direct community claims never masquerade as approved work-log claims."""
import uuid
from decimal import Decimal

import pytest

from .conftest import PASSWORD, category_id


@pytest.fixture
def community(api, db, period):
    from backend.models import Staff, StaffAssignment, User, UserReviewCadre, UserScope
    staff = db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == "chw1").one()
    assignment = db.query(StaffAssignment).filter_by(staff_id=staff.id).first()
    for name in ("csofin1", "csofin2"):
        user = db.query(User).filter_by(username=name).one()
        if not db.query(UserReviewCadre).filter_by(user_id=user.id, cadre_id=staff.cadre_id).first():
            db.add(UserReviewCadre(user_id=user.id, cadre_id=staff.cadre_id))
        if not db.query(UserScope).filter_by(user_id=user.id, region_id=assignment.region_id).first():
            db.add(UserScope(user_id=user.id, region_id=assignment.region_id))
    db.commit()
    return {"period_id": period["id"], "category_id": category_id(db, "C"),
            "declared_units": {"days": 2, "clients_followed_up": 4}, "description": "Reported community activity totals"}


def draft(api, community):
    return api.post("/community-claims", "chw1", community)


def verified(api, community, reviewer="tofficer1"):
    claim = draft(api, community)
    submitted = api.post(f"/claims/{claim['id']}/actions/submit", "chw1")
    assert submitted["status"] == "PENDING_COMMUNITY_VERIFICATION"
    return api.post(f"/claims/{claim['id']}/actions/verify_community", reviewer)


def test_provider_options_preview_draft_ownership_duplicate_and_locked_submission(api, db, community):
    from backend.models import PaymentClaim
    options = api.get(f"/community-claims/options?period_id={community['period_id']}", "chw1")
    category = next(c for c in options["categories"] if c["id"] == community["category_id"])
    assert {f["key"] for f in category["unit_fields"]} == {"days", "clients_followed_up"}
    quoted = api.post("/community-claims/preview", "chw1", community)
    assert quoted["amount"] > 0 and quoted["payor_name"] == "DEMO CSO Iringa"
    claim = draft(api, community)
    assert claim["work_type"] == "COMMUNITY" and claim["workflow_version"] == 2 and claim["work_log_id"] is None
    assert claim["route_code"] == "C" and claim["status"] == "DRAFT"
    assert claim["available_actions"] == ["submit", "cancel"]
    assert claim["payment_actions"] == [] and claim["payment_recipient"] is None
    assert float(claim["amount"]) == float(quoted["amount"])
    api.post("/community-claims", "chw1", community, expect=409)
    api.post("/community-claims", "csofin1", community, expect=403)
    api.post("/community-claims", "chw1", {**community, "staff_id": 999999}, expect=422)
    api.get(f"/claims/{claim['id']}", "hcp2", expect=404)
    api.get(f"/claims/{claim['id']}", "csofin1", expect=404)
    changed = api.put(f"/community-claims/{claim['id']}", "chw1", {
        "declared_units": {"days": 3, "clients_followed_up": 6}, "description": "Corrected draft totals",
    })
    assert float(changed["amount"]) == float(claim["amount"]) * 1.5
    api.post(f"/claims/{claim['id']}/actions/submit", "chw1")
    api.put(f"/community-claims/{claim['id']}", "chw1", {"declared_units": {"days": 1}}, expect=409)
    api.post(f"/claims/{claim['id']}/actions/verify_community", "chw1", expect=403)
    db.expire_all()
    assert db.get(PaymentClaim, claim["id"]).approved_at is None


@pytest.mark.parametrize("reviewer", ["tofficer1", "verifier1"])
def test_verifier_or_technical_review_goes_direct_to_independent_cso(api, db, community, reviewer):
    claim = verified(api, community, reviewer)
    assert claim["status"] == "AWAITING_APPROVAL" and claim["verified_at"] is not None
    assert "approve" in api.get(f"/claims/{claim['id']}", "csofin1")["available_actions"]
    api.post(f"/claims/{claim['id']}/actions/approve", "rpm1", expect=403)
    api.post(f"/claims/{claim['id']}/actions/approve", "fhifin1", expect=404)
    api.post(f"/claims/{claim['id']}/payments", "csofin1", {
        "amount": claim["amount"], "payment_reference": "BEFORE-APPROVAL", "payment_date": "2026-01-01",
    }, expect=409)
    approved = api.post(f"/claims/{claim['id']}/actions/approve", "csofin1")
    assert approved["status"] == "READY" and approved["approved_at"] is not None
    assert approved["payment_recipient"]["payment_account"]
    assert approved["payment_recipient"]["name"] == approved["staff_name"]
    assert approved["payor_name"] == approved["executor_name"] == "DEMO CSO Iringa"
    assert {row["action"] for row in approved["audit"]} >= {"create_community", "submit", "verify_community", "approve"}
    assert all(row["claim_id"] != claim["id"] for row in api.get("/finance/pending-routing", "admin"))


def test_captured_rates_survive_retirement_correction_and_cso_approval(api, db, community):
    from backend.models import RateRule
    claim = draft(api, community)
    rule = db.get(RateRule, claim["components"][0]["rate_rule_id"])
    old_rate, old_status = rule.rate_value, rule.status
    rule.rate_value, rule.status = old_rate * 10, "RETIRED"
    db.commit()
    try:
        edited = api.put(f"/community-claims/{claim['id']}", "chw1", {
            "declared_units": {"days": 3, "clients_followed_up": 6}, "description": "Corrected totals with original captured rate",
        })
        assert Decimal(str(edited["components"][0]["rate"])) == old_rate
        assert Decimal(str(edited["amount"])) == Decimal(str(claim["amount"])) * Decimal("1.5")
        api.post(f"/claims/{claim['id']}/actions/submit", "chw1")
        api.post(f"/claims/{claim['id']}/actions/verify_community", "tofficer1")
        approved = api.post(f"/claims/{claim['id']}/actions/approve", "csofin1")
        assert Decimal(str(approved["amount"])) == Decimal(str(claim["amount"])) * Decimal("1.5")
    finally:
        db.expire_all()
        rule.rate_value, rule.status = old_rate, old_status
        db.commit()


def test_return_requires_reason_unlocks_only_owner_and_demands_new_verification(api, community):
    claim = verified(api, community)
    api.post(f"/claims/{claim['id']}/actions/send_back", "csofin1", expect=422)
    returned = api.post(f"/claims/{claim['id']}/actions/send_back", "csofin1", {"comment": "Correct the days reported"})
    assert returned["status"] == "VALIDATION_NEEDED" and returned["verified_at"] is None
    api.put(f"/community-claims/{claim['id']}", "hcp2", {"declared_units": {"days": 1}}, expect=404)
    api.put(f"/community-claims/{claim['id']}", "chw1", {"declared_units": {"days": 1, "clients_followed_up": 2}})
    submitted = api.post(f"/claims/{claim['id']}/actions/submit", "chw1")
    assert submitted["status"] == "PENDING_COMMUNITY_VERIFICATION"
    api.post(f"/claims/{claim['id']}/actions/approve", "csofin1", expect=404)
    api.post(f"/claims/{claim['id']}/actions/send_back", "tofficer1", {"comment": "Please check the totals again"})


def test_wrong_regions_cadres_and_cso_cannot_verify_approve_or_pay(api, db, community):
    from backend.models import User, UserReviewCadre
    claim = draft(api, community)
    api.post(f"/claims/{claim['id']}/actions/submit", "chw1")
    api.get(f"/claims/{claim['id']}", "rpm2", expect=404)
    api.get(f"/claims/{claim['id']}", "csofin3", expect=404)
    api.post(f"/claims/{claim['id']}/actions/verify_community", "csofin1", expect=404)
    api.post(f"/claims/{claim['id']}/actions/verify_community", "tofficer1")
    actor = db.query(User).filter_by(username="csofin1").one()
    grants = db.query(UserReviewCadre).filter_by(user_id=actor.id).all()
    cadre_ids = [g.cadre_id for g in grants]
    db.query(UserReviewCadre).filter_by(user_id=actor.id).delete()
    db.commit()
    try:
        api.get(f"/claims/{claim['id']}", "csofin1", expect=404)
    finally:
        db.add_all([UserReviewCadre(user_id=actor.id, cadre_id=c) for c in cadre_ids])
        db.commit()


def test_dual_role_verifier_cannot_approve_the_claim_they_verified(api, db, community):
    from backend.core.security import hash_password
    from backend.models import Role, StaffAssignment, User, UserRole, UserReviewCadre, UserScope
    base = db.query(User).filter_by(username="tofficer1").one()
    name = "community_dual_" + uuid.uuid4().hex[:10]
    user = User(username=name, full_name="Synthetic dual-role reviewer", phone="+255710000998",
                hashed_password=hash_password(PASSWORD), must_change_password=False)
    db.add(user)
    db.flush()
    for role in db.query(Role).filter(Role.name.in_(("TECHNICAL_OFFICER", "CSO_FINANCE"))):
        db.add(UserRole(user_id=user.id, role_id=role.id))
    for scope in db.query(UserScope).filter_by(user_id=base.id):
        db.add(UserScope(user_id=user.id, region_id=scope.region_id, cluster_id=scope.cluster_id))
    assignment = db.query(StaffAssignment).filter_by(staff_id=1).first()
    db.add(UserScope(user_id=user.id, organization_id=assignment.organization_id))
    for grant in db.query(UserReviewCadre).filter_by(user_id=base.id):
        db.add(UserReviewCadre(user_id=user.id, cadre_id=grant.cadre_id))
    db.commit()
    claim = verified(api, community, name)
    response = api.post(f"/claims/{claim['id']}/actions/approve", name, expect=403)
    assert "independent" in response["detail"]
    api.post(f"/claims/{claim['id']}/actions/approve", "csofin1")


def test_empty_regional_budget_holds_then_releases_one_commitment(api, db, community):
    from backend.models import BudgetLine, BudgetTransaction
    claim = verified(api, community)
    line = db.get(BudgetLine, claim["budget_line_id"])
    allocation = line.allocated_amount
    line.allocated_amount = 0
    db.commit()
    held = api.post(f"/claims/{claim['id']}/actions/approve", "csofin1")
    assert held["status"] == "BUDGET_HOLD" and held["payment_actions"] == []
    api.post(f"/claims/{claim['id']}/actions/release", "rpm1", {"comment": "Cannot bypass CSO"}, expect=403)
    still_held = api.post(f"/claims/{claim['id']}/actions/release", "csofin2", {"comment": "Rechecked regional allocation"})
    assert still_held["status"] == "BUDGET_HOLD"
    db.expire_all()
    line.allocated_amount = allocation
    db.commit()
    ready = api.post(f"/claims/{claim['id']}/actions/release", "csofin2", {"comment": "Funding restored"})
    assert ready["status"] == "READY"
    api.post(f"/claims/{claim['id']}/actions/release", "csofin2", {"comment": "No duplicate commitment"}, expect=409)
    db.expire_all()
    assert line.committed_amount == Decimal(str(claim["amount"]))
    assert db.query(BudgetTransaction).filter_by(claim_id=claim["id"], kind="COMMIT").count() == 1


def test_payment_requires_proof_even_when_global_setting_is_off_and_reconciliation_is_independent(api, db, community):
    from backend.models import BudgetLine
    claim = verified(api, community)
    ready = api.post(f"/claims/{claim['id']}/actions/approve", "csofin1")
    amount = ready["amount"]
    api.put("/admin/settings/payment_requires_proof", "admin", {"value": False, "reason": "Direct community still requires proof"})
    try:
        api.post(f"/claims/{claim['id']}/payments", "csofin1", {
            "amount": amount, "payment_reference": "  ", "payment_date": "2026-01-01",
        }, expect=422)
        recorded = api.post(f"/claims/{claim['id']}/payments", "csofin1", {
            "amount": amount, "payment_reference": "SIMULATED-COMMUNITY-REFERENCE", "payment_date": "2026-01-01",
        })
        assert recorded["payment_status"] == "PROOF_REQUIRED"
        api.post(f"/claims/{claim['id']}/actions/confirm_paid", "csofin1", expect=422)
        proof = api.call("POST", f"/claims/{claim['id']}/proofs", "csofin1",
                         files={"file": ("simulated-receipt.pdf", b"%PDF-1.4\nSynthetic test receipt\n%%EOF", "application/pdf")})
        assert proof["payment_status"] == "PROOF_REQUIRED"
        paid = api.post(f"/claims/{claim['id']}/actions/confirm_paid", "csofin1")
        assert paid["payment_status"] == "PAID"
        api.post(f"/claims/{claim['id']}/actions/reconcile", "csofin1", {"comment": "Self reconciliation prohibited"}, expect=403)
        reconciled = api.post(f"/claims/{claim['id']}/actions/reconcile", "csofin2", {"comment": "Independent receipt review"})
        assert reconciled["payment_status"] == "RECONCILED"
        api.post(f"/claims/{claim['id']}/payments", "csofin1", {
            "amount": amount, "payment_reference": "NO-SECOND-PAYMENT", "payment_date": "2026-01-01",
        }, expect=409)
        db.expire_all()
        line = db.get(BudgetLine, claim["budget_line_id"])
        assert line.spent_amount == Decimal(str(amount)) and line.committed_amount == 0
    finally:
        api.put("/admin/settings/payment_requires_proof", "admin", {"value": True, "reason": "Restore proof policy"})


def test_partial_payment_followed_by_failed_attempt_cannot_be_cancelled(api, community):
    claim = verified(api, community)
    ready = api.post(f"/claims/{claim['id']}/actions/approve", "csofin1")
    body = {"amount": float(ready["amount"]) / 2, "payment_reference": "SIMULATED-PARTIAL",
            "payment_date": "2026-01-01", "status": "PARTIAL"}
    api.post(f"/claims/{claim['id']}/payments", "csofin1", body)
    failed = api.post(f"/claims/{claim['id']}/payments", "csofin1", {**body, "status": "FAILED", "payment_reference": "SIMULATED-FAILURE"})
    assert "cancel" not in failed["available_actions"]
    api.post(f"/claims/{claim['id']}/actions/cancel", "csofin1", {"comment": "Must not release a partly-paid liability"}, expect=403)


def test_provider_cancels_unsubmitted_claim_and_can_start_replacement(api, db, community):
    from backend.models import BudgetTransaction
    claim = draft(api, community)
    api.post(f"/claims/{claim['id']}/actions/cancel", "chw1", expect=422)
    cancelled = api.post(f"/claims/{claim['id']}/actions/cancel", "chw1", {"comment": "Entered the wrong category"})
    assert cancelled["status"] == "CANCELLED"
    assert db.query(BudgetTransaction).filter_by(claim_id=claim["id"]).count() == 0
    assert draft(api, community)["id"] != claim["id"]


def test_no_mapping_invalid_units_closed_period_and_noncommunity_category_fail_explicitly(api, db, community):
    from backend.models import CSORegionAssignment, PayPeriod, StaffAssignment
    api.post("/community-claims/preview", "chw1", {**community, "category_id": category_id(db, "A")}, expect=422)
    for units in ({"days": -1}, {"days": 1.5}, {"days": 0}, {"days": 2, "unapproved_count": 1000}):
        api.post("/community-claims", "chw1", {**community, "declared_units": units}, expect=422)
    assignment = db.query(StaffAssignment).filter_by(staff_id=1).first()
    mapping = db.query(CSORegionAssignment).filter_by(organization_id=assignment.organization_id, region_id=assignment.region_id).one()
    mapping.is_active = False
    db.commit()
    try:
        api.post("/community-claims", "chw1", community, expect=422)
    finally:
        mapping.is_active = True
        db.commit()
    period = db.get(PayPeriod, community["period_id"])
    period.status = "CLOSED"
    db.commit()
    api.post("/community-claims", "chw1", community, expect=422)
