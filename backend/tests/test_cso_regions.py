"""Explicit regional CSO authority, isolated allocations, and unchanged payment channels."""
import uuid
from decimal import Decimal

import pytest
from fastapi import HTTPException

from .conftest import category_id
from .test_finance_routing import reviewed_log, channel_body
from .test_v22_finance import v22, priced_activity, entered_log, to_finance


@pytest.fixture
def cso_context(db):
    from backend.models import CSORegionAssignment, Organization, Region
    org = db.query(Organization).filter_by(name="DEMO CSO Iringa").one()
    own_region = db.query(Region).filter_by(name="Iringa").one()
    mapping = db.query(CSORegionAssignment).filter_by(organization_id=org.id, region_id=own_region.id).one()
    other_region = db.query(Region).filter(Region.id != mapping.region_id).first()
    return org.id, mapping.region_id, other_region.id


def authority(api, org_id, region_id, active=True):
    return api.post("/organizations/assign-cso-region", "central1", {
        "organization_id": org_id, "region_id": region_id, "is_active": active,
    })


def line_body(db, period, org_id, region_id, **changes):
    return {"code": "CSO-" + uuid.uuid4().hex[:12], "name": "Explicit regional allocation",
            "organization_id": org_id, "region_id": region_id, "period_id": period["id"],
            "category_id": category_id(db, "B"), "allocated_amount": 1000, **changes}


def test_admin_creates_cso_maps_multiple_regions_and_preserves_audit(api, db, cso_context):
    from backend.models import AuditEvent, CSORegionAssignment
    _, own_region, other_region = cso_context
    body = {"name": "Configured CSO " + uuid.uuid4().hex[:10], "type": "CSO", "code": None}
    org = api.post("/organizations/create-org", "central1", body)
    api.post("/organizations/create-org", "central1", body, expect=409)
    first = authority(api, org["id"], own_region)
    authority(api, org["id"], other_region)
    assert org["id"] in {o["id"] for o in api.get(f"/organizations/cso-regions/{own_region}", "central1")}
    disabled = authority(api, org["id"], own_region, False)
    assert disabled["id"] == first["id"] and not disabled["is_active"]
    assert org["id"] not in {o["id"] for o in api.get(f"/organizations/cso-regions/{own_region}", "central1")}
    authority(api, org["id"], own_region)
    assert db.query(CSORegionAssignment).filter_by(organization_id=org["id"]).count() == 2
    assert db.query(AuditEvent).filter_by(entity_type="cso_region_assignment", entity_id=str(first["id"])).count() == 3
    api.post("/organizations/create-org", "central1", {**body, "name": "   "}, expect=422)


def test_only_admin_manages_mapping_and_only_csos_can_be_mapped(api, db, cso_context):
    org, region, _ = cso_context
    for username in ("csofin1", "fhifin1", "rpm1", "tofficer1", "chw1"):
        api.post("/organizations/assign-cso-region", username, {
            "organization_id": org, "region_id": region,
        }, expect=403)
        api.post("/organizations/create-org", username, {"name": "Not allowed", "type": "CSO"}, expect=403)
    partner = api.post("/organizations/create-org", "central1", {
        "name": "Partner " + uuid.uuid4().hex[:10], "type": "PARTNER",
    })
    api.post("/organizations/assign-cso-region", "central1", {
        "organization_id": partner["id"], "region_id": region,
    }, expect=422)
    api.post("/organizations/assign-cso-region", "central1", {
        "organization_id": org, "region_id": 999999,
    }, expect=422)


def test_cso_metadata_and_budgets_do_not_expose_other_organizations(api, cso_context, period):
    own, region, other_region = cso_context
    data = api.get("/organizations", "csofin1")
    assert not data["can_manage"]
    assert {o["id"] for o in data["organizations"]} == {own}
    assert {a["organization_id"] for a in data["assignments"]} == {own}
    assert {r["id"] for r in data["regions"]} == {region}
    api.get(f"/organizations/cso-regions/{other_region}", "csofin1", expect=404)
    assert all(line["organization_id"] == own for line in api.get("/budgets/lines", "csofin1"))
    assert all(line["region_id"] == region for line in api.get("/budgets/lines", "rpm1"))
    api.get("/organizations", "chw1", expect=403)


def test_new_cso_budgets_require_authorized_region_and_unique_bucket(api, db, period, cso_context):
    org, region, other_region = cso_context
    api.post("/budgets/lines", "csofin1", line_body(db, period, org, None), expect=422)
    api.post("/budgets/lines", "csofin1", line_body(db, period, org, other_region), expect=422)
    api.post("/budgets/lines", "csofin1", line_body(db, period, org, region), expect=409)
    authority(api, org, other_region)
    try:
        created = api.post("/budgets/lines", "csofin1", line_body(db, period, org, other_region))
        assert created["region_id"] == other_region
        api.post("/budgets/lines", "csofin1", line_body(db, period, org, other_region), expect=409)
        authority(api, org, other_region, False)
        api.post("/budgets/reallocate", "csofin1", {
            "from_line_id": created["id"], "to_line_id": next(
                r["id"] for r in api.get(f"/budgets/lines?period_id={period['id']}", "csofin1")
                if r["region_id"] == region and r["category_id"] == category_id(db, "B")
            ), "amount": 10, "reason": "Inactive authority cannot move funds",
        }, expect=422)
    finally:
        authority(api, org, other_region, False)


def test_period_region_must_match_budget_region(api, db, period, cso_context):
    org, region, other_region = cso_context
    regional = api.post("/admin/pay-periods", "central1", {
        "start_date": period["start_date"], "end_date": period["end_date"], "region_id": other_region, "status": "OPEN",
    })
    api.post("/budgets/lines", "csofin1", line_body(db, regional, org, region), expect=422)


def test_revocation_blocks_payors_and_both_routing_entrypoints_without_changing_claim(api, db, period, v22, cso_context):
    from backend.models import BudgetLine, PaymentClaim
    org, region, _ = cso_context
    log = reviewed_log(api, db, period, v22, "PAYROLL")
    body = channel_body(log)
    claim_id = body["claim_id"]
    authority(api, org, region, False)
    try:
        options = api.get(f"/finance/payors?work_log_id={log['id']}", v22["finance"])
        assert options["eligible_payors"] == [] and "not authorized" in options["routing_exception"]
        row = next(r for r in api.get("/finance/pending-routing", v22["finance"]) if r["work_log_id"] == log["id"])
        assert row["eligible_payors"] == [] and row["routing_exception"]
        api.post("/finance/channel", v22["finance"], body, expect=422)
        api.post(f"/worklogs/{log['id']}/actions/route_cso", v22["finance"], body, expect=422)
        db.expire_all()
        claim = db.get(PaymentClaim, claim_id)
        assert claim.status == "PENDING_ROUTING"
        assert db.get(BudgetLine, claim.budget_line_id).committed_amount == 0
    finally:
        authority(api, org, region)
    result = api.post("/finance/channel", v22["finance"], body)
    assert result["payor_id"] == org and result["status"] == "ROUTED_CSO"


def test_regional_zero_budget_holds_payroll_without_using_global_or_other_region(api, db, period, v22, cso_context):
    from backend.models import BudgetLine, BudgetTransaction, PaymentClaim
    org, region, other_region = cso_context
    # Preserve an imported historical global pool: it must not fund new-record regional payroll.
    historical = BudgetLine(
        code="HISTORICAL-" + uuid.uuid4().hex[:8], name="Historical all-region allocation",
        source="CSO", organization_id=org, category_id=category_id(db, "B"), period_id=period["id"],
        region_id=None, allocated_amount=1000000,
    )
    line = db.query(BudgetLine).filter_by(organization_id=org, period_id=period["id"],
                                       category_id=category_id(db, "B"), region_id=region).one()
    previous = line.allocated_amount
    line.allocated_amount = 0
    db.add(historical)
    db.commit()
    activity = priced_activity(api, v22, period, kind="PAYROLL", rate=500)
    pending = to_finance(api, entered_log(api, period, activity))
    reviewed = api.post(f"/worklogs/{pending['id']}/actions/finance_review", v22["finance"], {
        "review_confirmed": True, "review_type": "PAYROLL", "category_id": category_id(db, "B"),
    })
    held = api.post("/finance/channel", v22["finance"], channel_body(reviewed))
    assert held["status"] == "BUDGET_HOLD" and held["claim_status"] == "BUDGET_HOLD"
    db.expire_all()
    claim = db.get(PaymentClaim, held["claim_id"])
    assert claim.budget_line_id == line.id
    assert historical.committed_amount == 0 and historical.spent_amount == 0
    assert db.query(BudgetTransaction).filter_by(claim_id=claim.id, kind="COMMIT").count() == 0
    line.allocated_amount = previous
    db.commit()
    released = api.post("/finance/channel", v22["finance"], {
        "claim_id": claim.id, "target_payor_id": org, "review_confirmed": True, "review_type": "PAYROLL",
        "comment": "The regional payroll allocation has been restored",
    })
    assert released["claim_id"] == claim.id and released["status"] == "ROUTED_CSO"
    db.expire_all()
    assert line.committed_amount == Decimal("1000")
    assert db.query(BudgetTransaction).filter_by(claim_id=claim.id, kind="COMMIT").count() == 1


def test_strict_region_resolution_rejects_missing_or_ambiguous_but_preserves_legacy(db, period, cso_context):
    from backend.models import BudgetLine
    from backend.services.budgets import find_line
    org, region, other_region = cso_context
    assert find_line(db, category_id(db, "B"), period["id"], org, other_region, strict_region=True) is None
    existing = db.query(BudgetLine).filter_by(organization_id=org, period_id=period["id"],
                                           category_id=category_id(db, "B"), region_id=region).one()
    duplicate = BudgetLine(code="IMPORTED-" + uuid.uuid4().hex[:10], name="Historical ambiguous allocation",
                          source="CSO", organization_id=org, region_id=region, category_id=existing.category_id,
                          period_id=period["id"], allocated_amount=1000)
    db.add(duplicate)
    db.flush()
    with pytest.raises(HTTPException) as error:
        find_line(db, existing.category_id, period["id"], org, region, strict_region=True)
    assert error.value.status_code == 422 and "Multiple CSO budget lines" in error.value.detail
    assert find_line(db, existing.category_id, period["id"], org, region) is not None
    db.rollback()


def test_rpm_cannot_reallocate_to_a_different_region_even_in_same_cso(api, db, period, cso_context):
    org, region, other_region = cso_context
    authority(api, org, other_region)
    try:
        target = api.post("/budgets/lines", "csofin1", line_body(db, period, org, other_region))
        source = next(line for line in api.get(f"/budgets/lines?period_id={period['id']}", "csofin1")
                      if line["region_id"] == region and line["category_id"] == category_id(db, "B"))
        api.post("/budgets/reallocate", "rpm1", {
            "from_line_id": source["id"], "to_line_id": target["id"], "amount": 10,
            "reason": "Outside assigned RPM region",
        }, expect=403)
        api.get(f"/budgets/lines/{target['id']}/ledger", "rpm1", expect=404)
    finally:
        authority(api, org, other_region, False)
