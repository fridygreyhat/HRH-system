"""Activity type is Services or Payroll; category still identifies the exact allocation."""
from types import SimpleNamespace

import pytest

from backend.services.budgets import category_activity_type
from .test_dual_budgets import allocation


@pytest.mark.parametrize("form_type,expected", [
    ("SALARY", "PAYROLL"),
    ("CHW_PNP", "SERVICES"),
    ("HCP_PNP", "SERVICES"),
    ("COORDINATION", "SERVICES"),
    ("COMMUNITY_SERVICE", "SERVICES"),
    (None, None),
    ("UNKNOWN", None),
])
def test_activity_type_uses_configured_form_not_name_or_route(form_type, expected):
    assert category_activity_type(SimpleNamespace(form_type=form_type)) == expected


@pytest.mark.parametrize("activity_type,form_type", [
    ("SERVICES", "COMMUNITY_SERVICE"), ("PAYROLL", "SALARY"),
])
def test_matching_type_preserves_exact_budget_payment_item(api, db, period, activity_type, form_type):
    from backend.models import ClaimCategory
    body = allocation(db, period, activity_type=activity_type)
    category = db.get(ClaimCategory, body["category_id"])
    original = category.form_type
    try:
        category.form_type = form_type
        db.commit()
        line = api.post("/budgets/lines", "fhifin1", body)
        assert line["activity_type"] == activity_type
        assert line["category_id"] == body["category_id"]
        assert line["allocated_amount"] == body["allocated_amount"]
        viewed = api.get(f"/budgets/lines/{line['id']}/ledger", "fhifin1")["line"]
        assert viewed["activity_type"] == activity_type
        assert viewed["category_id"] == body["category_id"]
    finally:
        category.form_type = original
        db.commit()


@pytest.mark.parametrize("form_type,active,activity_type", [
    ("SALARY", True, "SERVICES"),
    ("CHW_PNP", True, "PAYROLL"),
    (None, True, "SERVICES"),
    ("UNKNOWN", True, "SERVICES"),
    ("HCP_PNP", False, "SERVICES"),
    ("COMMUNITY_SERVICE", True, "COMMUNITY"),
])
def test_wrong_unknown_inactive_or_third_type_cannot_create_budget(
    api, db, period, form_type, active, activity_type,
):
    from backend.models import BudgetLine, ClaimCategory
    body = allocation(db, period, activity_type=activity_type)
    category = db.get(ClaimCategory, body["category_id"])
    original = category.form_type, category.is_active
    try:
        category.form_type, category.is_active = form_type, active
        db.commit()
        api.post("/budgets/lines", "fhifin1", body, expect=422)
        assert db.query(BudgetLine).filter_by(code=body["code"]).count() == 0
    finally:
        category.form_type, category.is_active = original
        db.commit()
