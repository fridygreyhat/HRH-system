"""Rate maintenance is immediate; claim history is never rewritten."""
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest

from backend.models import ClaimCategory, ClaimComponent, PaymentClaim, RateRule, Staff, User
from backend.services.claims import calculate
from backend.services.community_claims import active_rules
from backend.services.rate_rules import rate_rule_out


@pytest.fixture
def rate_body(api):
    category = api.post("/admin/claim-categories", "fhifin1", {
        "name": f"Rate maintenance {uuid4().hex[:10]}", "route_id": 1,
        "funding_source_id": 1, "payor_org_id": 1, "budget_owner": "PAYOR",
        "origin_channel": "FACILITY", "requires_work_log": True, "is_active": True,
    })
    return {"category_id": category["id"], "component_name": "Daily service",
            "unit_type": "FIXED", "rate_value": 40000, "effective_start_date": "2020-01-01"}


def calculated(db, body):
    # API calls use a different ORM session; do not assert against cached rows.
    db.expire_all()
    staff = db.query(Staff).first()
    return calculate(db, db.get(ClaimCategory, body["category_id"]), staff,
                     SimpleNamespace(start_date=date(2026, 10, 1), end_date=date(2026, 10, 31)),
                     None, None, None)


def test_saved_rates_price_work_immediately_and_can_be_edited(api, db, rate_body):
    rule = api.post("/admin/rate-rules", "fhifin1", rate_body)
    assert rule["status"] == "ACTIVE"
    assert rule["approved_by"] is None and rule["approved_at"] is None
    community_rates = active_rules(
        db, db.get(ClaimCategory, rate_body["category_id"]), db.query(Staff).first(),
        SimpleNamespace(start_date=date(2026, 10, 1), end_date=date(2026, 10, 31)),
        SimpleNamespace(region_id=1),
    )
    assert [r.id for r in community_rates] == [rule["id"]]
    components, errors = calculated(db, rate_body)
    assert not errors and components[0]["amount"] == Decimal("40000")
    updated = api.put(f"/admin/rate-rules/{rule['id']}", "fhifin1", {**rate_body, "rate_value": 50000})
    assert updated["id"] == rule["id"] and updated["status"] == "ACTIVE"
    assert calculated(db, rate_body)[0][0]["amount"] == Decimal("50000")
    result = api.call("DELETE", f"/admin/rate-rules/{rule['id']}", "fhifin1")
    assert result["retained_for_history"] is False
    db.expire_all()
    assert db.get(RateRule, rule["id"]) is None
    assert calculated(db, rate_body)[0] == []


def test_legacy_pending_rates_no_longer_require_approval(api, db, rate_body):
    rule = api.post("/admin/rate-rules", "fhifin1", rate_body)
    row = db.get(RateRule, rule["id"])
    row.status = "PENDING_APPROVAL"
    db.commit()
    listed = next(r for r in api.get("/admin/rate-rules", "rpm1") if r["id"] == row.id)
    assert listed["status"] == "ACTIVE"
    assert calculated(db, rate_body)[0][0]["amount"] == Decimal("40000")
    assert rate_rule_out(row)["status"] == "ACTIVE"
    assert active_rules(
        db, db.get(ClaimCategory, rate_body["category_id"]), db.query(Staff).first(),
        SimpleNamespace(start_date=date(2026, 10, 1), end_date=date(2026, 10, 31)),
        SimpleNamespace(region_id=1),
    )[0].id == rule["id"]
    updated = api.put(f"/admin/rate-rules/{row.id}", "fhifin1", {**rate_body, "rate_value": 41000})
    assert updated["status"] == "ACTIVE"


@pytest.mark.parametrize("edit_first", [False, True])
def test_edit_and_delete_preserve_used_rate_and_claim_snapshot(api, db, rate_body, period, edit_first):
    rule = api.post("/admin/rate-rules", "fhifin1", rate_body)
    claim = PaymentClaim(staff_id=db.query(Staff.id).first()[0],
                         category_id=rate_body["category_id"], period_id=period["id"],
                         created_by=db.query(User.id).filter(User.username == "fhifin1").scalar(),
                         amount=40000, calculation_snapshot={"amount": "40000"})
    db.add(claim)
    db.flush()
    component = ClaimComponent(claim_id=claim.id, rate_rule_id=rule["id"],
                               component_name="Daily service", unit_type="FIXED",
                               units=1, rate=40000, amount=40000)
    db.add(component)
    db.commit()
    if edit_first:
        replacement = api.put(f"/admin/rate-rules/{rule['id']}", "fhifin1", {**rate_body, "rate_value": 60000})
        assert replacement["id"] != rule["id"] and replacement["status"] == "ACTIVE"
    db.expire_all()
    assert db.get(RateRule, rule["id"]).status == ("RETIRED" if edit_first else "ACTIVE")
    assert db.get(RateRule, rule["id"]).rate_value == Decimal("40000")
    assert claim.amount == Decimal("40000") and component.rate == Decimal("40000")
    assert claim.calculation_snapshot == {"amount": "40000"}
    assert calculated(db, rate_body)[0][0]["amount"] == Decimal("60000" if edit_first else "40000")
    result = api.call("DELETE", f"/admin/rate-rules/{rule['id']}", "fhifin1")
    assert result["retained_for_history"] is True
    db.expire_all()
    assert db.get(RateRule, rule["id"]) is not None and component.rate_rule_id == rule["id"]
    assert db.get(RateRule, rule["id"]).status == "RETIRED"
    api.put(f"/admin/rate-rules/{rule['id']}", "fhifin1", rate_body, expect=409)


@pytest.mark.parametrize("username", ["rpm1", "tofficer1", "chw1"])
def test_reviewers_and_providers_cannot_change_rates(api, rate_body, username):
    rule = api.post("/admin/rate-rules", "fhifin1", rate_body)
    api.post("/admin/rate-rules", username, rate_body, expect=403)
    api.put(f"/admin/rate-rules/{rule['id']}", username, rate_body, expect=403)
    api.call("DELETE", f"/admin/rate-rules/{rule['id']}", username, expect=403)


def test_invalid_rates_and_removed_approval_endpoints(api, rate_body):
    rule = api.post("/admin/rate-rules", "admin", rate_body)
    for changes in ({"rate_value": -1}, {"cap_amount": -1}, {"category_id": 9999999},
                    {"effective_end_date": "2019-01-01"}, {"unit_type": "PER_UNIT"}):
        api.post("/admin/rate-rules", "fhifin1", {**rate_body, **changes}, expect=422)
        api.put(f"/admin/rate-rules/{rule['id']}", "fhifin1", {**rate_body, **changes}, expect=422)
    api.put("/admin/rate-rules/9999999", "fhifin1", rate_body, expect=404)
    api.call("DELETE", "/admin/rate-rules/9999999", "fhifin1", expect=404)
    api.post(f"/admin/rate-rules/{rule['id']}/approve", "rpm1", expect=404)
    api.post(f"/admin/rate-rules/{rule['id']}/reject", "rpm1", expect=404)
