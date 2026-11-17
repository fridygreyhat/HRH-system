"""Monthly financial audit and reconciliation: CSO salary payments, and approved against paid for Payroll and Services."""
import io
import json
from decimal import Decimal

import pytest
from openpyxl import load_workbook
from sqlalchemy import text

from backend.models import AuditEvent, Organization, PaymentClaim, PaymentRecord, Region, User
from .conftest import category_id, make_period
from .test_finance_missing_rates import unpriced_log
from .test_finance_monthly_reports import all_cadres
from .test_salary_timesheets import approved_log, bearer, sign, staff_of
from .test_v22_finance import v22  # noqa: F401 (fixture)

PDF = ("schedule.pdf", b"%PDF-1.4\nBank schedule\n%%EOF", "application/pdf")


@pytest.fixture
def signed_month(api, db, v22):
    """A Payroll month Regional Finance has signed, with chw1 on the CSO's salary file (the CHW package: 150,000)."""
    all_cadres(db, v22["finance"])
    all_cadres(db, "csofin1")
    period = make_period(api, db)
    _, entry, placement = approved_log(db, period, "chw1")
    month = entry.entry_date.strftime("%Y-%m")
    sign(api, v22, month)
    return {"month": month, "period": period, "cso_id": placement.organization_id, "staff_id": placement.staff_id,
            "region_id": placement.region_id, "finance": v22["finance"]}


def pay(api, state, rows, reference, files=True, user="csofin1", expect=201, status="PAID", day=None):
    data = {"cso_id": str(state["cso_id"]), "month": state["month"], "items": json.dumps(rows),
            "payment_date": day or f"{state['month']}-20", "payment_reference": reference, "payment_method": "BANK", "status": status}
    response = api.client.post("/cso-finance/salary-payments", data=data, files={"proof": PDF} if files else None,
                               headers=bearer(api, user))
    assert response.status_code == expect, response.text
    return response.json()


def payroll_row(api, state, user="fhifin1"):
    result = api.get(f"/finance/reconciliation?month={state['month']}&region_id={state['region_id']}&work_type=PAYROLL", user)
    return result, next(row for row in result["providers"] if row["staff_id"] == state["staff_id"])


def test_cso_records_salary_payments_and_finance_reconciles_them(api, db, signed_month):
    state = signed_month
    due = api.get(f"/cso-finance/salary-payments?cso_id={state['cso_id']}&month={state['month']}", "csofin1")
    chw = next(row for row in due["providers"] if row["staff_id"] == state["staff_id"])
    assert (chw["expected"], chw["paid"], chw["outstanding"]) == ("150000.00", "0", "150000.00")
    _, row = payroll_row(api, state)
    assert (row["status"], row["expected"], row["outstanding"], row["issues"]) == ("NOT_PAID", "150000.00", "150000.00", ["NOT_PAID"])

    # Proof of payment is required, the amount cannot exceed what is due, and only signed providers can be paid.
    pay(api, state, [{"staff_id": state["staff_id"]}], "BANK-001", files=False, expect=422)
    pay(api, state, [{"staff_id": state["staff_id"], "amount": "150000.01"}], "BANK-001", expect=422)
    other = staff_of(db, "hcp2").id
    pay(api, state, [{"staff_id": state["staff_id"]}, {"staff_id": other}], "BANK-001", expect=422)
    pay(api, state, [{"staff_id": state["staff_id"]}], "BANK-001", day="2999-01-01", expect=422)

    first = pay(api, state, [{"staff_id": state["staff_id"], "amount": "100000"}], "BANK-001")
    assert first["recorded"] == 1 and first["payments"][0]["has_proof"]
    _, row = payroll_row(api, state)
    assert (row["status"], row["paid"], row["outstanding"]) == ("PART_PAID", "100000.00", "50000.00")
    pay(api, state, [{"staff_id": state["staff_id"], "amount": "60000"}], "BANK-002", expect=422)  # more than is due
    rest = pay(api, state, [{"staff_id": state["staff_id"]}], "BANK-002")  # the rest by default
    assert rest["payments"][0]["amount"] == "50000.00"
    result, row = payroll_row(api, state)
    assert (row["status"], row["paid"], row["outstanding"], row["issues"]) == ("PAID", "150000.00", "0.00", [])
    assert row["references"] == ["BANK-001", "BANK-002"]
    pay(api, state, [{"staff_id": state["staff_id"]}], "BANK-003", expect=409)  # already paid in full

    # A mistake is voided with a reason, never edited or deleted; the money is due again.
    payment_id = rest["payments"][0]["id"]
    api.post(f"/cso-finance/salary-payments/{payment_id}/void", "csofin1", {"cso_id": state["cso_id"], "reason": "Bank reversed it"})
    api.post(f"/cso-finance/salary-payments/{payment_id}/void", "csofin1", {"cso_id": state["cso_id"], "reason": "Again"}, expect=409)
    api.post(f"/cso-finance/salary-payments/{payment_id}/void", "csofin3", {"cso_id": state["cso_id"], "reason": "Not mine"}, expect=404)
    _, row = payroll_row(api, state)
    assert (row["status"], row["outstanding"]) == ("PART_PAID", "50000.00")
    with pytest.raises(Exception):
        db.execute(text("UPDATE payroll_payments SET amount = 1 WHERE id = :id"), {"id": payment_id})
        db.commit()
    db.rollback()
    with pytest.raises(Exception):
        db.execute(text("DELETE FROM payroll_payments WHERE id = :id"), {"id": payment_id})
        db.commit()
    db.rollback()
    listed = api.get(f"/cso-finance/salary-payments?cso_id={state['cso_id']}&month={state['month']}", "csofin1")["payments"]
    assert {p["payment_reference"]: p["voided"] for p in listed} == {"BANK-001": False, "BANK-002": True}
    assert db.query(AuditEvent).filter_by(action="record_salary_payments").count() >= 2
    assert db.query(AuditEvent).filter_by(entity_type="payroll_payment", action="void").count() >= 1

    # Auditors download the bank schedule from the reconciliation.
    proof = api.client.get(f"/finance/reconciliation/payroll-payments/{first['payments'][0]['id']}/proof", headers=bearer(api, "fhifin1"))
    assert proof.status_code == 200 and proof.content.startswith(b"%PDF")
    history = api.get(f"/finance/reconciliation/payroll-payments?month={state['month']}&staff_id={state['staff_id']}", "oversight1")
    assert [p["voided"] for p in history] == [False, True]


def test_who_sees_signs_and_the_dashboards(api, db, signed_month):
    """One signed month for all of these: the suite has few past months left for pay periods (conftest.test_month)."""
    _who_sees_and_signs(api, db, signed_month)  # ends with the CHW paid in full
    _super_admin_and_the_dashboard(api, db, signed_month)
    _central_dashboard(api, db, signed_month)
    _services(api, db, signed_month["period"])


def _who_sees_and_signs(api, db, state):
    path = f"/finance/reconciliation?month={state['month']}"
    for user in ("fhifin1", "oversight1", state["finance"]):
        assert api.get(path, user)["month"] == state["month"]
    for user in ("csofin1", "chw1", "rpm1", "supervisor1"):
        api.get(path, user, expect=403)
    other = db.query(Region).filter(Region.id != state["region_id"]).first()
    api.get(f"{path}&region_id={other.id}", state["finance"], expect=403)  # Regional Finance: own regions only

    result = api.get(f"{path}&region_id={state['region_id']}", "fhifin1")
    assert result["can_sign"] and result["signoff"] is None and result["issues"]
    body = {"month": state["month"], "region_id": state["region_id"], "expected_digest": result["digest"]}
    api.post("/finance/reconciliation/sign", "oversight1", {**body, "note": "Read only"}, expect=403)
    api.post("/finance/reconciliation/sign", "fhifin1", body, expect=422)  # open issues need a note
    api.post("/finance/reconciliation/sign", "fhifin1", {**body, "expected_digest": "0" * 64, "note": "Followed up with the CSO"}, expect=409)
    signed = api.post("/finance/reconciliation/sign", "fhifin1", {**body, "note": "CHW salary due; CSO paying on the 28th."})
    assert signed["current"] and signed["signed_by_name"]
    assert api.get(f"{path}&region_id={state['region_id']}", "fhifin1")["signoff"]["current"] is True
    pay(api, state, [{"staff_id": state["staff_id"]}], "BANK-SIGNED")
    after = api.get(f"{path}&region_id={state['region_id']}", "fhifin1")["signoff"]
    assert after["current"] is False  # the figures changed after signing: sign again

    file = api.client.get(f"/finance/reconciliation/export?month={state['month']}&region_id={state['region_id']}&format=xlsx",
                          headers=bearer(api, "oversight1"))
    assert file.status_code == 200 and file.headers["cache-control"] == "no-store"
    book = load_workbook(io.BytesIO(file.content))
    assert book.sheetnames == ["Summary", "Providers", "Issues"]
    providers = [dict(zip([c.value for c in book["Providers"][1]], [c.value for c in row])) for row in book["Providers"].iter_rows(min_row=2)]
    assert any(p["Staff ID"] == state["staff_id"] and p["Status"] == "Paid in full" for p in providers)
    csv_file = api.client.get(f"/finance/reconciliation/export?month={state['month']}&format=csv", headers=bearer(api, "fhifin1"))
    assert csv_file.status_code == 200 and csv_file.content.startswith(b"\xef\xbb\xbfMonth,Work type")
    assert db.query(AuditEvent).filter_by(entity_type="finance_reconciliation", action="download").count() >= 2


def _services(api, db, period):
    owner = db.query(User).filter_by(username="admin").one()
    fhi360 = db.query(Organization).filter_by(type="FHI360").first().id  # FHI360 pays Services (route A)

    def claim(provider, status, amount, paid=None, proof=False):
        log, _, placement = unpriced_log(db, period, provider, "SERVICES")
        row = PaymentClaim(workflow_version=2, work_type="SERVICES", work_log_id=log.id, staff_id=log.staff_id,
                           period_id=log.period_id, assignment_id=log.assignment_id, route_code="A",
                           category_id=None if status == "PENDING_FINANCE_REVIEW" else category_id(db, "A"),
                           amount=Decimal(amount), currency="TZS", status=status, created_by=owner.id,
                           payor_org_id=fhi360, executor_org_id=fhi360)
        db.add(row)
        db.flush()
        if paid:
            db.add(PaymentRecord(claim_id=row.id, payment_reference=f"SRV-{row.id}", amount=Decimal(paid),
                                 payment_date=placement.start_date, status="PARTIAL", recorded_by=owner.id))
        db.commit()
        return row, placement

    ready, placement = claim("chw1", "READY", "40000", paid="10000")
    cancelled, _ = claim("hcp1", "CANCELLED", "20000", paid="20000")
    review, _ = claim("clerk1", "PENDING_FINANCE_REVIEW", "30000")
    from datetime import date
    from backend.core.period_dates import pay_month_of
    month = pay_month_of(date.fromisoformat(period["end_date"]))  # a claim counts in the pay month its period ends in
    result = api.get(f"/finance/reconciliation?month={month}&region_id={placement.region_id}&work_type=SERVICES", "fhifin1")
    rows = {row["claim_id"]: row for row in result["providers"]}
    assert (rows[ready.id]["status"], rows[ready.id]["outstanding"]) == ("PART_PAID", "30000.00")
    assert set(rows[ready.id]["issues"]) == {"PART_PAID", "NO_PROOF"}
    assert rows[cancelled.id]["status"] == "PAID_CANCELLED" and rows[cancelled.id]["overpaid"] == "20000.00"
    assert (rows[review.id]["status"], rows[review.id]["in_review"], rows[review.id]["issues"]) == ("IN_REVIEW", "30000.00", [])
    totals = result["totals"]["SERVICES"]
    assert (totals["expected"], totals["paid"], totals["outstanding"], totals["in_review"]) == ("40000.00", "30000.00", "30000.00", "30000.00")
    assert {g["cadre_code"] for g in result["summary"]} == {"CHW", "HCP", "DATA_CLERK"}
    only_chw = api.get(f"/finance/reconciliation?month={month}&region_id={placement.region_id}&work_type=SERVICES&cadre=CHW", "fhifin1")
    assert {row["cadre_code"] for row in only_chw["providers"]} == {"CHW"} and only_chw["can_sign"] is False
    # Payroll for a month Regional Finance has not signed is listed as an open issue, not as money owed.
    unsigned = api.get(f"/finance/reconciliation?month=2094-03&region_id={placement.region_id}&work_type=PAYROLL", "fhifin1")
    assert [i["issue"] for i in unsigned["issues"]] == ["PAYROLL_NOT_SIGNED"] and unsigned["providers"] == []


def _super_admin_and_the_dashboard(api, db, state):
    for user in ("admin", "fhifin1", "oversight1", state["finance"]):  # the Super Admin sees and signs like Central Finance
        result = api.get(f"/finance/reconciliation?month={state['month']}", user)
        assert result["month"] == state["month"]
    assert api.get(f"/finance/reconciliation?month={state['month']}", "admin")["can_sign"] is True
    for user in ("csofin1", "chw1"):
        api.get(f"/finance/reconciliation/dashboard?month={state['month']}", user, expect=403)

    board = api.get(f"/finance/reconciliation/dashboard?month={state['month']}&months=3&region_id={state['region_id']}", "admin")
    assert [m["month"] for m in board["months"]][-1] == state["month"] and len(board["months"]) == 3
    payroll = board["totals"]["payroll"]
    assert Decimal(payroll["paid"]) >= 150000 and Decimal(payroll["expected"]) >= 150000
    region = next(r for r in board["by_region"] if r["key"] == db.get(Region, state["region_id"]).name)
    assert Decimal(region["payroll_paid"]) >= 150000 and "budget_allocated" in region
    chw = next(c for c in board["by_cadre"] if c["key"] == "CHW")
    assert Decimal(chw["payroll_expected"]) >= 150000 and Decimal(chw["payroll_paid"]) >= 150000
    assert set(board["totals"]["budget"]) == {"allocated", "used", "remaining"}
    api.get(f"/finance/reconciliation/dashboard?month={state['month']}&months=13", "admin", expect=422)


def _central_dashboard(api, db, state):
    year, number = map(int, state["month"].split("-"))
    start = f"{year - (number <= 2)}-{(number - 3) % 12 + 1:02d}"  # two months before
    board = api.get(f"/finance/reconciliation/overview?start={start}&end={state['month']}", "admin")
    assert [m["month"] for m in board["months"]][-1] == state["month"] and len(board["months"]) == 3
    month = board["months"][-1]
    assert Decimal(month["salary_paid"]) >= 150000 and Decimal(month["salary_expected"]) >= 150000
    region = next(r for r in board["by_region"] if r["region"] == db.get(Region, state["region_id"]).name)
    assert [m["month"] for m in region["months"]] == [m["month"] for m in board["months"]]
    assert Decimal(region["total"]["salary_paid"]) >= 150000
    assert any(c["cadre"] == "Community Health Worker" for c in board["by_cadre"])
    assert Decimal(board["totals"]["salary_paid"]) >= Decimal(month["salary_paid"])
    for user in ("fhifin1", "oversight1", state["finance"]):
        api.get(f"/finance/reconciliation/overview?start={state['month']}&end={state['month']}", user)
    api.get(f"/finance/reconciliation/overview?start={state['month']}&end={state['month']}", "csofin1", expect=403)
    api.get(f"/finance/reconciliation/overview?start={state['month']}&end={start}", "admin", expect=422)  # backwards
    api.get(f"/finance/reconciliation/overview?start=2000-01&end=2026-01", "admin", expect=422)  # more than 24 months
