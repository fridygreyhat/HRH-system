import csv
from io import StringIO
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import event

from backend.models import Staff, StaffAssignment, WorkLogEntry, PaymentClaim, WorkLog, User
from backend.core.security import load_current_user
from backend.services import services_finance_exports as exports
from .test_named_central_review import reviewed
from .test_services_without_budgets import empty_period
from .test_v22_finance import central_approve, v22
from .test_ctc_facility_approval import no_provider_sms

pytestmark = pytest.mark.usefixtures("no_provider_sms")


def route(api, db, period, v22):
    log, body = reviewed(api, db, period, v22)
    result = api.post("/finance/channel", v22["finance"], body)
    return db.get(PaymentClaim, result["claim_id"])


def fetch(api, month, fmt="csv", user="fhifin1"):
    return api.client.get(f"/finance/services-payment-report/export?month={month}&format={fmt}",
                          headers={"Authorization": f"Bearer {api.token(user)}"})


def test_routed_services_csv_pdf_fields_and_scope(api, db, empty_period, v22):
    claim = route(api, db, empty_period, v22)
    staff = db.get(Staff, claim.staff_id)
    staff.mobile_money_number = "+255700000001"
    staff.first_name = "=FORMULA"
    db.commit()
    month = empty_period["start_date"][:7]
    response = fetch(api, month)
    assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
    rows = list(csv.DictReader(StringIO(response.content.decode("utf-8-sig"))))
    assert rows[0]["Region"] and rows[0]["Facility"] and rows[0]["Services name"]
    assert rows[0]["Provider name"].startswith("'=")
    assert rows[0]["Mobile number"] == "+255700000001"  # usable in a bulk-pay upload; it is a number, not a formula
    assert rows[0]["Days worked"] == "1" and rows[0]["Payable days"] == "1"
    assert Decimal(rows[0]["Service amount"]) == 40000
    assert rows[-1]["Region"] == "TOTAL ALL SERVICES"
    assert Decimal(rows[-1]["Service amount"]) == 40000
    # The PDF is the payment form: only claims Central Finance has approved are on it.
    assert fetch(api, month, "pdf").status_code == 404
    central_approve(api, claim.id)
    pdf = fetch(api, month, "pdf")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    for user in ("chw1", "csofin1", v22["finance"]):
        assert fetch(api, month, user=user).status_code == 403
    reviewer = db.query(User).filter_by(username="fhifin1").one()
    from backend.models import UserReviewCadre
    db.query(UserReviewCadre).filter_by(user_id=reviewer.id).delete()
    db.commit()
    assert fetch(api, month).status_code == 404


def test_multiple_services_count_worked_days_but_pay_only_one(api, db, empty_period, v22):
    claim = route(api, db, empty_period, v22)
    entry = db.query(WorkLogEntry).filter_by(work_log_id=claim.work_log_id).one()
    entry.activity_snapshot = {**entry.activity_snapshot, "additional_services": [
        {"activity": {"key": "tb_contact", "label_en": "TB Contact tracing"}, "measures": {}}]}
    db.commit()
    response = fetch(api, empty_period["start_date"][:7])
    rows = list(csv.DictReader(StringIO(response.content.decode("utf-8-sig"))))
    tb = next(row for row in rows if row["Services name"] == "TB Contact tracing")
    assert tb["Days worked"] == "1" and tb["Payable days"] == "0"
    assert Decimal(tb["Service amount"]) == 0
    assert Decimal(rows[-1]["Service amount"]) == claim.amount

    # Shortfalls show beside the money and never change it, including a service with no days at all.
    placement = db.get(StaffAssignment, claim.assignment_id)
    target = {"label_sw": "Huduma", "cadre_id": db.get(WorkLog, claim.work_log_id).cadre_id, "region_id": placement.region_id, "item_type": "SERVICES",
              "form_mode": "SINGLE", "unit_type": "PER_DAY", "rate_value": 100, "currency": "TZS", "effective_start_date": empty_period["start_date"]}
    api.post("/rates", "admin", {**target, "label_en": "TB Contact tracing", "min_days_per_month": 5})
    api.post("/rates", "admin", {**target, "label_en": "Never worked service", "min_days_per_month": 3})
    rows = list(csv.DictReader(StringIO(fetch(api, empty_period["start_date"][:7]).content.decode("utf-8-sig"))))
    tb = next(row for row in rows if row["Services name"] == "TB Contact tracing")
    assert (tb["Days worked"], tb["Minimum days"], tb["Days short"]) == ("1", "5", "4")
    missing = next(row for row in rows if row["Services name"] == "Never worked service")
    assert (missing["Days worked"], missing["Service amount"], missing["Minimum days"], missing["Days short"]) == ("0", "0", "3", "3")
    assert Decimal(rows[-1]["Service amount"]) == claim.amount
    central_approve(api, claim.id)  # the PDF payment form lists approved claims only
    db.refresh(claim)
    assert fetch(api, empty_period["start_date"][:7], "pdf").status_code == 200

    # A claim Finance has not routed yet is not in the report or its total.
    routed_status = claim.status
    claim.status = "PENDING_ROUTING"
    db.commit()
    assert fetch(api, empty_period["start_date"][:7]).status_code == 404
    claim.status = routed_status
    db.commit()

    # The report follows the pay month: the 26th already belongs to the next month. Same test, as past months are limited.
    original = entry.entry_date
    entry.entry_date = original.replace(day=26)
    db.commit()
    later = f"{original.year + 1}-01" if original.month == 12 else f"{original.year}-{original.month + 1:02d}"
    assert list(csv.DictReader(StringIO(fetch(api, original.strftime("%Y-%m")).content.decode("utf-8-sig")))) == []
    assert list(csv.DictReader(StringIO(fetch(api, later).content.decode("utf-8-sig"))))[0]["Days worked"] == "1"
    entry.entry_date = original
    db.commit()


def test_services_export_includes_over_one_thousand_providers_without_n_plus_one(api, db, empty_period, v22):
    claim = route(api, db, empty_period, v22)
    placement = db.get(StaffAssignment, claim.assignment_id)
    source_log = db.get(WorkLog, claim.work_log_id)
    source_entry = db.query(WorkLogEntry).filter_by(work_log_id=source_log.id).one()
    providers = [Staff(cadre_id=source_log.cadre_id, first_name="Isolated", last_name=f"Provider {i:04}",
                       verified_phone=f"+255000{i:06}") for i in range(1100)]
    db.add_all(providers)
    db.flush()
    placements = [StaffAssignment(staff_id=p.id, region_id=placement.region_id,
                                 facility_id=placement.facility_id, start_date=date(2020, 1, 1)) for p in providers]
    db.add_all(placements)
    db.flush()
    logs = [WorkLog(staff_id=p.id, assignment_id=a.id, cadre_id=p.cadre_id, period_id=claim.period_id,
                    work_type="SERVICES", workflow_version=2, status="ROUTED_FHI360")
            for p, a in zip(providers, placements)]
    db.add_all(logs)
    db.flush()
    for p, a, log in zip(providers, placements, logs):
        db.add(WorkLogEntry(work_log_id=log.id, entry_date=source_entry.entry_date,
                           hours_worked=2, evidence_text="", activity_key=source_entry.activity_key,
                           activity_snapshot=source_entry.activity_snapshot))
        db.add(PaymentClaim(work_log_id=log.id, workflow_version=2, work_type="SERVICES",
                            staff_id=p.id, assignment_id=a.id, category_id=claim.category_id,
                            period_id=claim.period_id, route_code=claim.route_code,
                            executor_org_id=claim.executor_org_id, payor_org_id=claim.payor_org_id,
                            created_by=claim.created_by, amount=claim.amount, currency=claim.currency,
                            status="PENDING_CENTRAL_REVIEW", calculation_snapshot=claim.calculation_snapshot))
    db.commit()
    current = load_current_user(db, db.query(User).filter_by(username="fhifin1").one())
    queries = []
    def count(*args):
        queries.append(1)
    event.listen(db.bind, "before_cursor_execute", count)
    try:
        rows = exports.rows(db, current, empty_period["start_date"][:7])
    finally:
        event.remove(db.bind, "before_cursor_execute", count)
    assert len(rows) == 1101
    assert len(queries) <= 4
    assert sum(Decimal(row[6]) for row in rows) == Decimal(40000) * 1101
    assert exports.pdf_file(rows, empty_period["start_date"][:7]).startswith(b"%PDF")
    page = api.get("/claims?work_type=SERVICES&offset=1000&limit=2", "fhifin1")
    assert len(page) == 2 and page[0]["id"] != page[1]["id"]
    api.get("/claims?limit=501", "fhifin1", expect=422)
    api.get("/claims?offset=-1", "fhifin1", expect=422)
