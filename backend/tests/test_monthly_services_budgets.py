from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier

import pytest
from fastapi import HTTPException

from backend.models import MonthlyServiceBudget, MonthlyServiceBudgetCharge, PaymentClaim, User, Region
from backend.core.security import load_current_user
from backend.services.monthly_service_budgets import deduct
from .test_named_central_review import reviewed
from .test_services_without_budgets import empty_period
from .test_v22_finance import v22
from .test_ctc_facility_approval import no_provider_sms

pytestmark = pytest.mark.usefixtures("no_provider_sms")


def upload(api, user, region, month, amount=100000, filename="budget.csv", data=b"Services budget\n100000\n"):
    return api.client.post("/monthly-service-budgets", headers={"Authorization": f"Bearer {api.token(user)}"},
        data={"region_id": str(region), "month": month, "allocated_amount": str(amount), "currency": "TZS"},
        files={"file": (filename, data, "application/octet-stream")})


def test_monthly_budget_upload_update_document_and_region_permissions(api, db, empty_period, v22):
    region, month, user = v22["region_id"], empty_period["start_date"][:7], v22["finance"]
    response = upload(api, user, region, month)
    assert response.status_code == 200, response.text
    row = response.json()
    assert row["remaining_amount"] == "100000.00" and row["deducted_amount"] == "0.00"
    assert "document_data" not in row
    assert upload(api, user, region, month, 150000).json()["id"] == row["id"]
    assert len(api.get(f"/monthly-service-budgets?month={month}", user)) == 1
    doc = api.client.get(f"/monthly-service-budgets/{row['id']}/document",
                         headers={"Authorization": f"Bearer {api.token(user)}"})
    assert doc.status_code == 200 and doc.content.startswith(b"Services budget")
    assert doc.headers["cache-control"] == "no-store"
    other = db.query(Region).filter(Region.id != region).first()
    assert upload(api, user, other.id, month).status_code == 403
    for denied in ("chw1", "csofin1", "fhifin1"):
        assert upload(api, denied, region, month).status_code == 403
    assert upload(api, user, region, month, filename="bad.pdf", data=b"not pdf").status_code == 422
    assert upload(api, user, region, month, data=b"a" * (2 * 1024 * 1024 + 1)).status_code == 413
    assert upload(api, user, region, "2026-13").status_code == 422


def test_submission_deducts_once_blocks_missing_or_short_budget_and_does_not_double_charge_payment(api, db, empty_period, v22):
    log, body = reviewed(api, db, empty_period, v22)
    month = empty_period["start_date"][:7]
    db.query(MonthlyServiceBudget).filter_by(month=month, region_id=v22["region_id"]).delete()
    db.commit()
    api.post("/finance/channel", v22["finance"], body, expect=409)
    assert api.get(f"/worklogs/{log['id']}", v22["finance"])["status"] == "FINANCE_REVIEWED"
    assert db.query(MonthlyServiceBudgetCharge).filter_by(claim_id=log["claims"][0]["id"]).count() == 0
    assert upload(api, v22["finance"], v22["region_id"], month, 39999).status_code == 200
    api.post("/finance/channel", v22["finance"], body, expect=409)
    assert upload(api, v22["finance"], v22["region_id"], month, 100000).status_code == 200
    routed = api.post("/finance/channel", v22["finance"], body)
    cid = routed["claim_id"]
    budget = db.query(MonthlyServiceBudget).filter_by(month=month, region_id=v22["region_id"]).one()
    db.refresh(budget)
    assert budget.deducted_amount == 40000
    actor = load_current_user(db, db.query(User).filter_by(username=v22["finance"]).one())
    deduct(db, actor, db.get(PaymentClaim, cid))
    db.commit()
    assert db.query(MonthlyServiceBudgetCharge).filter_by(claim_id=cid).count() == 1
    assert upload(api, v22["finance"], v22["region_id"], month, 39999).status_code == 409
    api.post(f"/claims/{cid}/actions/central_approve", "fhifin1", {"review_confirmed": True, "expected_amount": 40000})
    api.put("/admin/settings/payment_requires_proof", "admin", {"value": False, "reason": "Isolated monthly deduction test"})
    try:
        api.put("/provider-details/me", "chw1", {"mobile_money_number": "+255700000001"})
        api.post(f"/claims/{cid}/payments", "fhifin1", {
            "amount": 40000, "payment_reference": "ISOLATED-MONTHLY-BUDGET",
            "payment_date": empty_period["start_date"],
        })
    finally:
        api.put("/admin/settings/payment_requires_proof", "admin", {"value": True, "reason": "Restore proof protection"})
    db.refresh(budget)
    assert budget.deducted_amount == 40000
    api.post(f"/claims/{cid}/actions/cancel", "fhifin1", {"comment": "Cannot refund paid Services"}, expect=403)


def test_unpaid_cancellation_restores_monthly_budget_once(api, db, empty_period, v22):
    log, body = reviewed(api, db, empty_period, v22)
    cid = api.post("/finance/channel", v22["finance"], body)["claim_id"]
    api.post(f"/claims/{cid}/actions/cancel", "fhifin1", {"comment": "Needs correction by the provider"})
    budget = db.query(MonthlyServiceBudget).filter_by(month=empty_period["start_date"][:7], region_id=v22["region_id"]).one()
    db.refresh(budget)
    assert budget.deducted_amount == 0
    charge = db.query(MonthlyServiceBudgetCharge).filter_by(claim_id=cid).one()
    assert charge.released_at
    api.post(f"/claims/{cid}/actions/cancel", "fhifin1", {"comment": "Repeated cancellation"}, expect=409)
    db.refresh(budget)
    assert budget.deducted_amount == 0


def test_competing_submissions_refresh_preloaded_budget_under_lock(api, db, empty_period, v22):
    first, _ = reviewed(api, db, empty_period, v22, "chw1")
    second, _ = reviewed(api, db, empty_period, v22, "hcp1")
    claim_ids = [db.query(PaymentClaim.id).filter_by(work_log_id=log["id"]).scalar() for log in (first, second)]
    budget = db.query(MonthlyServiceBudget).filter_by(month=empty_period["start_date"][:7], region_id=v22["region_id"]).one()
    budget.allocated_amount = 50000
    db.commit()
    budget_id, user = budget.id, v22["finance"]
    db.rollback()
    barrier = Barrier(2)
    def compete(claim_id):
        from backend.db.session import SessionLocal
        with SessionLocal() as session:
            stale = session.get(MonthlyServiceBudget, budget_id)
            assert stale.deducted_amount == 0
            actor = load_current_user(session, session.query(User).filter_by(username=user).one())
            claim = session.query(PaymentClaim).filter_by(id=claim_id).with_for_update().one()
            barrier.wait(timeout=10)
            try:
                deduct(session, actor, claim)
                session.commit()
                return "ok"
            except HTTPException as exc:
                session.rollback()
                assert exc.status_code == 409
                return "short"
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(compete, claim_ids)) == ["ok", "short"]
    db.expire_all()
    assert db.get(MonthlyServiceBudget, budget_id).deducted_amount == Decimal(40000)


def test_multi_month_claim_deducts_by_dates_and_rolls_back_all_months_on_shortfall(api, db, empty_period, v22):
    log, _ = reviewed(api, db, empty_period, v22)
    claim = db.query(PaymentClaim).filter_by(work_log_id=log["id"]).one()
    first_month = empty_period["start_date"][:7]
    later_month = "2099-01"  # test periods share a month counter, so a nearby month may already have a budget
    line = claim.calculation_snapshot["lines"][0]
    claim.calculation_snapshot = {**claim.calculation_snapshot, "lines": [
        {**line, "date": first_month + "-01", "amount": "20000"},
        {**line, "date": later_month + "-01", "amount": "20000"},
    ]}
    db.commit()
    actor = load_current_user(db, db.query(User).filter_by(username=v22["finance"]).one())
    with pytest.raises(HTTPException):
        deduct(db, actor, claim)
    db.rollback()
    budget = db.query(MonthlyServiceBudget).filter_by(month=first_month, region_id=v22["region_id"]).one()
    assert budget.deducted_amount == 0
    assert upload(api, v22["finance"], v22["region_id"], later_month, 30000).status_code == 200
    deduct(db, actor, db.get(PaymentClaim, claim.id))
    db.commit()
    values = {b.month: b.deducted_amount for b in db.query(MonthlyServiceBudget).filter_by(region_id=v22["region_id"])}
    assert values[first_month] == values[later_month] == 20000
