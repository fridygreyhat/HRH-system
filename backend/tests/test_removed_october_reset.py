"""The removed October reset cannot clear any work or financial records."""
from backend.models import BudgetLine, BudgetTransaction, PayPeriod, WorkLog, WorkLogEntry, WorkLogMeasure


def test_october_reset_routes_are_removed_and_records_unchanged(api, db):
    periods = api.get("/admin/pay-periods", "admin")
    october = next(period for period in periods if period["start_date"] == "2026-10-01"
                   and period["end_date"] == "2026-10-31" and period["region_id"] is None)
    models = (PayPeriod, WorkLog, WorkLogEntry, WorkLogMeasure, BudgetLine, BudgetTransaction)
    before = {model.__name__: db.query(model).count() for model in models}
    root = f"/admin/pay-periods/{october['id']}"
    api.get(root + "/work-reset-preview", "admin", expect=404)
    api.post(root + "/clear-work-records", "admin", {
        "confirmation": "CLEAR OCTOBER 2026", "preview_token": "0" * 64,
        "reason": "This removed action must never clear records",
    }, expect=404)
    assert {model.__name__: db.query(model).count() for model in models} == before
    assert api.get("/admin/pay-periods", "admin") == periods
