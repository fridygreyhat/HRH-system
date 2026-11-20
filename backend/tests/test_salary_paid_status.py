"""Once the CSO records a salary as paid, with its proof, the list it received and Regional Finance's page say so."""
from .test_reconciliation import pay, signed_month  # noqa: F401 (fixture)
from .test_v22_finance import v22  # noqa: F401 (fixture)


def listed(api, state):
    result = api.get(f"/cso-finance/salary-timesheets?cso_id={state['cso_id']}&month={state['month']}", "csofin1")
    return result, next(p for p in result["providers"] if p["staff_id"] == state["staff_id"])


def _as_of(db, state, username):
    """The status lists cover the last few closed pay months: ask as of a day just after this test's month."""
    from datetime import timedelta
    from backend.core.period_dates import pay_month_range
    from backend.core.security import load_current_user
    from backend.models import User
    db.expire_all()  # see what the API just recorded
    year, month = map(int, state["month"].split("-"))
    following = f"{year + 1}-01" if month == 12 else f"{year}-{month + 1:02d}"
    current = load_current_user(db, db.query(User).filter_by(username=username).one())
    return current, pay_month_range(following)[0] + timedelta(days=1)


def regional(api, state, db=None):
    from backend.services.monthly_report_approval import signoff_status
    current, today = _as_of(db, state, state["finance"])
    return next(item for item in signoff_status(db, current, today)
                if item["work_type"] == "PAYROLL" and item["month"] == state["month"] and item["region_id"] == state["region_id"])


def cso_status(api, state, db=None):
    from backend.services.monthly_report_approval import cso_payroll_status
    current, today = _as_of(db, state, "csofin1")
    return next(item for item in cso_payroll_status(db, current, today)
                if item["month"] == state["month"] and item["region_id"] == state["region_id"])


def test_the_received_list_shows_each_salary_as_paid_once_recorded_with_proof(api, db, signed_month):
    state = signed_month
    result, row = listed(api, state)
    assert (row["payment_status"], row["paid_amount"]) == ("NOT_PAID", "0")
    paid_before = result["totals"]["paid_providers"]
    assert regional(api, state, db)["paid_providers"] == cso_status(api, state, db)["paid_providers"] == paid_before

    first = pay(api, state, [{"staff_id": state["staff_id"], "amount": "100000"}], "PAID-STATUS-1")
    _, row = listed(api, state)
    assert (row["payment_status"], row["paid_amount"]) == ("PART_PAID", "100000.00")
    assert regional(api, state, db)["paid_providers"] == paid_before  # part paid is not paid

    pay(api, state, [{"staff_id": state["staff_id"]}], "PAID-STATUS-2")
    result, row = listed(api, state)
    assert (row["payment_status"], row["paid_amount"]) == ("PAID", "150000.00")
    assert result["totals"]["paid_providers"] == paid_before + 1
    assert regional(api, state, db)["paid_providers"] == cso_status(api, state, db)["paid_providers"] == paid_before + 1

    # A voided payment no longer counts: the salary shows as part paid again.
    api.post(f"/cso-finance/salary-payments/{first['payments'][0]['id']}/void", "csofin1",
             {"cso_id": state["cso_id"], "reason": "Wrong account"})
    _, row = listed(api, state)
    assert (row["payment_status"], row["paid_amount"]) == ("PART_PAID", "50000.00")
    assert regional(api, state, db)["paid_providers"] == paid_before
