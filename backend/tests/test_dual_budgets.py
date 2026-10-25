"""Planning estimates warn; committed-plus-spent exposure is limited only by the cap."""
import csv
import io
import uuid
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier

import pytest
from sqlalchemy.orm import Session

from .conftest import category_id


def allocation(db, period, **changes):
    from backend.models import Organization, Region
    return {"code": "DUAL-" + uuid.uuid4().hex, "name": "Synthetic dual budget",
            "organization_id": db.query(Organization).filter_by(name="DEMO CSO Iringa").one().id,
            "region_id": db.query(Region).filter_by(name="Iringa").one().id,
            "category_id": category_id(db, "A"), "period_id": period["id"],
            "allocated_amount": 100, "estimated_amount": 50, "currency": "TZS", **changes}


def test_both_finance_teams_manage_cso_estimates_without_expanding_other_roles(api, db, period):
    body = allocation(db, period)
    line = api.post("/budget/allocate", "fhifin1", body)
    assert line["estimated_amount"] == 50 and line["allocated_amount"] == 100
    assert line["budget_status"] == "WITHIN_ESTIMATE"
    updated = api.put(f"/budgets/lines/{line['id']}/allocation", "csofin1", {
        "estimated_amount": 60, "allocated_amount": 120, "reason": "Updated regional projection",
    })
    assert updated["estimated_amount"] == 60 and updated["allocated_amount"] == 120
    for user in ("csofin3", "rpm1", "tofficer1", "chw1"):
        response = api.call("PUT", f"/budgets/lines/{line['id']}/allocation", user, json={
            "estimated_amount": 70, "allocated_amount": 130, "reason": "Not authorized",
        }, expect=404 if user == "csofin3" else 403)
        assert response["detail"]
    api.put(f"/budgets/lines/{line['id']}/allocation", "fhifin1", {
        "estimated_amount": None, "allocated_amount": 120, "reason": "Projection not supplied",
    })
    ledger = api.get(f"/budgets/lines/{line['id']}/ledger", "csofin1")
    assert ledger["line"]["estimated_amount"] is None and ledger["line"]["budget_status"] == "NOT_SET"
    assert sum(Decimal(str(t["amount"])) for t in ledger["transactions"]) == 120


def test_invalid_estimates_and_cap_reductions_leave_money_unchanged(api, db, period):
    from backend.models import BudgetLine
    from backend.services import budgets
    for change in ({"estimated_amount": -1}, {"estimated_amount": 101},
                   {"estimated_amount": "NaN"}, {"allocated_amount": "Infinity"},
                   {"allocated_amount": "100.001"}, {"estimated_amount": "9999999999999999"}):
        api.post("/budgets/lines", "fhifin1", allocation(db, period, **change), expect=422)
    line = api.post("/budgets/lines", "csofin1", allocation(db, period))
    budgets.commit(db, line["id"], Decimal(40), None, None)
    db.commit()
    api.put(f"/budgets/lines/{line['id']}/allocation", "fhifin1", {
        "estimated_amount": 20, "allocated_amount": 39, "reason": "Cannot erase liabilities",
    }, expect=422)
    api.put(f"/budgets/lines/{line['id']}/allocation", "fhifin1", {
        "estimated_amount": 20, "allocated_amount": 100, "reason": "   ",
    }, expect=422)
    db.expire_all()
    assert db.get(BudgetLine, line["id"]).allocated_amount == 100


def test_estimate_crossing_does_not_block_and_spending_does_not_double_count(api, db, period):
    from backend.models import BudgetLine
    from backend.services import budgets
    line = api.post("/budgets/lines", "fhifin1", allocation(db, period))
    budgets.commit(db, line["id"], Decimal(60), None, None)
    db.commit()
    viewed = next(row for row in api.get("/budgets/lines", "csofin1") if row["id"] == line["id"])
    assert viewed["estimate_warning"] and viewed["budget_status"] == "ESTIMATE_REACHED"
    assert viewed["exposure_amount"] == 60 and viewed["available_amount"] == 40
    budgets.spend(db, line["id"], Decimal(20), None, None, None)
    db.commit()
    viewed = api.get(f"/budgets/lines/{line['id']}/ledger", "fhifin1")["line"]
    assert viewed["committed_amount"] == 40 and viewed["spent_amount"] == 20 and viewed["exposure_amount"] == 60
    budgets.commit(db, line["id"], Decimal(40), None, None)
    db.commit()
    assert budgets.planning_status(db.get(BudgetLine, line["id"]))["budget_status"] == "HARD_CAP_REACHED"
    with pytest.raises(budgets.InsufficientBudget):
        budgets.commit(db, line["id"], Decimal("0.01"), None, None)
    db.rollback()


def test_no_historical_projection_is_invented_and_zero_is_not_missing(api, db, period):
    body = allocation(db, period)
    del body["estimated_amount"]
    line = api.post("/budgets/lines", "fhifin1", body)
    assert line["estimated_amount"] is None and line["budget_status"] == "NOT_SET"
    updated = api.put(f"/budgets/lines/{line['id']}/allocation", "csofin1", {
        "estimated_amount": 0, "allocated_amount": 100, "reason": "Explicit zero projection",
    })
    assert updated["estimated_amount"] == 0 and updated["budget_status"] == "WITHIN_ESTIMATE"
    from backend.services import budgets
    budgets.commit(db, line["id"], Decimal(1), None, None)
    db.commit()
    assert api.get(f"/budgets/lines/{line['id']}/ledger", "csofin1")["line"]["estimate_warning"]


def test_concurrent_approvals_refresh_loaded_balances_before_commit(api, db, period):
    from backend.models import BudgetLine
    from backend.services import budgets
    line = api.post("/budgets/lines", "fhifin1", allocation(db, period))
    barrier = Barrier(2)
    engine = db.get_bind()

    def approve():
        with Session(engine) as session:
            # Both sessions deliberately have an old identity-map balance.
            loaded = session.get(BudgetLine, line["id"])
            assert loaded.committed_amount == 0
            barrier.wait(timeout=10)
            try:
                budgets.commit(session, loaded.id, Decimal(75), None, None)
                session.commit()
                return "committed"
            except budgets.InsufficientBudget:
                session.rollback()
                return "held"
    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(lambda _: approve(), range(2)))
    assert sorted(results) == ["committed", "held"]
    db.expire_all()
    assert db.get(BudgetLine, line["id"]).committed_amount == 75


def test_central_finance_still_needs_cso_region_authority(api, db, period):
    from backend.models import CSORegionAssignment
    body = allocation(db, period)
    mapping = db.query(CSORegionAssignment).filter_by(organization_id=body["organization_id"], region_id=body["region_id"]).one()
    mapping.is_active = False
    db.commit()
    try:
        api.post("/budgets/lines", "fhifin1", body, expect=422)
    finally:
        mapping.is_active = True
        db.commit()


def test_tracker_preserves_estimates_for_old_csv_and_exports_unknown_as_blank(api, db, period):
    from backend.models import Organization, BudgetLine
    org = db.query(Organization).filter_by(type="FHI360").first()
    body = allocation(db, period, organization_id=org.id)
    line = api.post("/budgets/lines", "fhifin1", body)
    category = api.get("/admin/claim-categories", "fhifin1")
    name = next(row["name"] for row in category if row["id"] == body["category_id"])
    content = io.StringIO()
    writer = csv.writer(content)
    writer.writerow(["code", "name", "category", "period_start", "region", "allocated_amount"])
    writer.writerow([body["code"], body["name"], name, period["start_date"], "Iringa", 150])
    result = api.call("POST", "/budgets/tracker/import", "fhifin1",
                      files={"file": ("legacy-format.csv", content.getvalue().encode(), "text/csv")})
    assert result["success_count"] == 1
    db.expire_all()
    assert db.get(BudgetLine, line["id"]).estimated_amount == 50
    raw = api.client.post("/budgets/tracker/export", headers={"Authorization": f"Bearer {api.token('fhifin1')}"})
    assert raw.status_code == 200
    rows = list(csv.DictReader(io.StringIO(raw.text)))
    assert next(row for row in rows if row["code"] == body["code"])["estimated_amount"] == "50.00"


def test_reallocation_keeps_estimate_and_cap_consistent(api, db, period):
    from backend.models import Organization
    org = db.query(Organization).filter_by(type="FHI360").first()
    source = api.post("/budgets/lines", "fhifin1", allocation(db, period, organization_id=org.id, estimated_amount=80))
    target = api.post("/budgets/lines", "fhifin1", allocation(db, period, organization_id=org.id, estimated_amount=None))
    transfer = {"from_line_id": source["id"], "to_line_id": target["id"], "amount": 50, "reason": "Move unused allocation"}
    api.post("/budgets/reallocate", "fhifin1", transfer, expect=422)
    api.put(f"/budgets/lines/{source['id']}/allocation", "fhifin1", {
        "estimated_amount": 40, "allocated_amount": 100, "reason": "Revise forecast before transfer",
    })
    moved = api.post("/budgets/reallocate", "fhifin1", transfer)
    assert moved["from"]["allocated_amount"] == 50 and moved["from"]["estimated_amount"] == 40
    assert moved["to"]["allocated_amount"] == 150 and moved["to"]["estimated_amount"] is None
