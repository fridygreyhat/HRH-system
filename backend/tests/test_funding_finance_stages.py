"""Programme choices and funding integrity across Services finance stages."""
from decimal import Decimal
import importlib

from alembic.migration import MigrationContext
from alembic.operations import Operations

from backend.models import BudgetLine, BudgetTransaction, ClaimCategory, FundingSource, PaymentClaim
from .conftest import category_id
from .test_finance_missing_rates import unpriced_log, rate_for
from .test_v22_finance import v22


def finance_work(api, db, period, v22):
    log, entry, assignment = unpriced_log(db, period)
    rate_for(db, log, assignment, entry.activity_key, entry.entry_date, amount=40000)
    source = db.query(FundingSource).filter_by(name="PnP").one()
    category = db.get(ClaimCategory, category_id(db, "A"))
    category.funding_source_id = source.id
    db.commit()
    result = api.post(f"/worklogs/{log.id}/actions/authorize", "rpm1",
                      {"review_confirmed": True, "review_type": "SERVICES"})
    return result, category, source


def review_body(category, source):
    return {"category_id": category.id, "funding_source_id": source.id,
            "review_confirmed": True, "review_type": "SERVICES"}


def review_work(api, v22, work, category, source):
    return api.post(f"/worklogs/{work['id']}/actions/finance_review", v22["finance"],
                    review_body(category, source))


def route_work(api, v22, work, expect=None, **extra):
    return api.post("/finance/channel", v22["finance"], {
        "work_log_id": work.get("id", work.get("work_log_id")), "target_payor_id": work["finance_snapshot"]["payor_org_id"],
        "expected_review_token": work["finance_snapshot"]["review_token"],
        "review_confirmed": True, "review_type": "SERVICES",
        **extra,
    }, expect=expect)


def test_programme_catalogue_is_available_and_idempotent(api, db, v22):
    names = {item["name"] for item in api.get("/admin/funding-sources", v22["finance"])}
    assert {"PnP", "Supply Chain", "EpiC"} <= names
    before = {(item.id, item.code, item.name) for item in db.query(FundingSource)}
    revision = importlib.import_module("backend.alembic.versions.18b6f30d5412_standard_funding_sources")
    with Operations.context(MigrationContext.configure(db.connection())):
        revision.upgrade()
    db.commit()
    assert {(item.id, item.code, item.name) for item in db.query(FundingSource)} == before


def test_initial_funding_setup_requires_central_permission_and_explicit_assignment(api, db, period, v22):
    from uuid import uuid4
    template = db.get(ClaimCategory, category_id(db, "A"))
    category = ClaimCategory(name=f"Unconfigured synthetic service {uuid4().hex[:8]}",
                             form_type="SERVICES", route_id=template.route_id,
                             payor_org_id=template.payor_org_id)
    db.add(category)
    db.commit()
    source = db.query(FundingSource).filter_by(name="PnP").one()
    path = f"/finance/categories/{category.id}/funding-source"
    body = {"funding_source_id": source.id, "reason": "Explicit programme setup"}
    api.put(path, v22["finance"], body, expect=403)
    assigned = api.put(path, "fhifin1", body)
    assert assigned["funding_source_id"] == source.id
    assert api.put(path, "fhifin1", body)["funding_source_id"] == source.id
    other = db.query(FundingSource).filter_by(name="EpiC").one()
    api.put(path, "fhifin1", {**body, "funding_source_id": other.id}, expect=409)
    db.expire_all()
    assert category.funding_source_id == source.id


def test_initial_setup_cannot_reclassify_a_category_with_live_claims(api, db, period, v22):
    work, category, source = finance_work(api, db, period, v22)
    reviewed = review_work(api, v22, work, category, source)
    original_source = reviewed["claims"][0]["id"]
    category.funding_source_id = None  # Simulated imported/incorrect configuration.
    db.commit()
    api.put(f"/finance/categories/{category.id}/funding-source", "fhifin1", {
        "funding_source_id": source.id, "reason": "Must not reclassify live financial data",
    }, expect=409)
    assert db.get(PaymentClaim, original_source).funding_source_id == source.id


def test_funding_source_must_match_category_without_advancing_state(api, db, period, v22):
    work, category, _ = finance_work(api, db, period, v22)
    wrong = db.query(FundingSource).filter_by(name="EpiC").one()
    result = api.post(f"/worklogs/{work['id']}/actions/finance_review", v22["finance"],
                      review_body(category, wrong), expect=422)
    assert "does not match" in result["detail"]
    fresh = api.get(f"/worklogs/{work['id']}", v22["finance"])
    assert fresh["status"] == "PENDING_FINANCE_REVIEW" and fresh["finance_snapshot"] is None
    assert fresh["claims"][0]["status"] == "PENDING_FINANCE_REVIEW"


def test_missing_calculation_snapshot_recovers_from_saved_work_terms(api, db, period, v22):
    work, category, source = finance_work(api, db, period, v22)
    proposal = db.get(PaymentClaim, work["claims"][0]["id"])
    proposal.calculation_snapshot = None
    db.commit()
    reviewed = review_work(api, v22, work, category, source)
    assert reviewed["status"] == "FINANCE_REVIEWED"
    assert reviewed["finance_snapshot"]["funding_source_id"] == source.id
    assert reviewed["finance_snapshot"]["funding_source_name"] == "PnP"
    assert Decimal(reviewed["claims"][0]["amount"]) == 40000


def test_review_source_change_requires_explicit_rereview_and_rejects_stale_screen(api, db, period, v22):
    work, category, source = finance_work(api, db, period, v22)
    reviewed = review_work(api, v22, work, category, source)
    claim_id = reviewed["claims"][0]["id"]
    replacement = db.query(FundingSource).filter_by(name="EpiC").one()
    category.funding_source_id = replacement.id
    db.commit()
    refused = route_work(api, v22, reviewed, expect=409)
    assert "changed after review" in refused["detail"]
    assert db.query(BudgetTransaction).filter_by(claim_id=claim_id).count() == 0
    rereviewed = review_work(api, v22, reviewed, category, replacement)
    assert rereviewed["claims"][0]["id"] == claim_id
    assert rereviewed["finance_snapshot"]["review_token"] != reviewed["finance_snapshot"]["review_token"]
    # A second reviewer has corrected the setup; an older screen cannot route it.
    refused = route_work(api, v22, reviewed, expect=409)
    assert "Another Finance review" in refused["detail"]
    routed = route_work(api, v22, rereviewed)
    assert routed["status"] == "ROUTED_FHI360"
    db.expire_all()
    claim = db.get(PaymentClaim, claim_id)
    assert claim.funding_source_id == replacement.id and claim.amount == 40000
    assert claim.budget_line_id is None
    assert db.query(BudgetTransaction).filter_by(claim_id=claim_id).count() == 0
    # A double click cannot route the claim a second time.
    route_work(api, v22, rereviewed, expect=409)
    assert db.query(BudgetTransaction).filter_by(claim_id=claim_id).count() == 0


def test_unused_budget_currency_does_not_block_fixed_daily_services(api, db, period, v22):
    work, category, source = finance_work(api, db, period, v22)
    reviewed = review_work(api, v22, work, category, source)
    line = db.query(BudgetLine).filter_by(category_id=category.id, period_id=period["id"]).one()
    line.currency = "USD"
    db.commit()
    assert route_work(api, v22, reviewed)["status"] == "ROUTED_FHI360"
    assert reviewed["finance_snapshot"]["currency"] == "TZS"


def test_old_uncommitted_services_hold_can_be_reviewed_without_a_budget(api, db, period, v22):
    from backend.models import WorkLog
    work, category, source = finance_work(api, db, period, v22)
    reviewed = review_work(api, v22, work, category, source)
    line = db.query(BudgetLine).filter_by(category_id=category.id, period_id=period["id"]).one()
    line.allocated_amount = 0
    log = db.get(WorkLog, work["id"])
    old_snapshot = {**log.finance_snapshot, "budget_line_id": line.id}
    old_snapshot.pop("payment_policy")
    log.finance_snapshot, log.status = old_snapshot, "BUDGET_HOLD"
    claim_id = reviewed["claims"][0]["id"]
    proposal = db.get(PaymentClaim, claim_id)
    proposal.status, proposal.budget_line_id = "BUDGET_HOLD", line.id
    db.commit()
    held = api.get(f"/worklogs/{work['id']}", v22["finance"])
    assert "finance_review" in held["available_actions"]
    reviewed = review_work(api, v22, held, category, source)
    released = route_work(api, v22, reviewed)
    assert released["status"] == "ROUTED_FHI360" and released["claim_id"] == claim_id
    db.expire_all()
    assert db.get(PaymentClaim, claim_id).funding_source_id == source.id
    assert db.get(PaymentClaim, claim_id).budget_line_id is None
    assert db.query(BudgetTransaction).filter_by(claim_id=claim_id).count() == 0
