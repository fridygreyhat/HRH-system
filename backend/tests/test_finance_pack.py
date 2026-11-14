"""Finance downloads (Payroll and Services separate, by region, facility or person) and sending a month of Services."""
import csv
import io
import uuid
from decimal import Decimal

import pytest
from openpyxl import load_workbook

from backend.models import PaymentClaim, StaffAssignment, WorkLog
from backend.services import finance_pack
from .test_approval_finance_visibility import approve_to_regional_finance, prepare
from .test_ctc_facility_approval import no_provider_sms
from .test_finance_monthly_reports import all_cadres
from .test_named_central_review import reviewed
from .test_salary_timesheets import bearer, provider_details
from .test_services_without_budgets import empty_period
from .test_v22_finance import v22

pytestmark = pytest.mark.usefixtures("no_provider_sms")


def month_of(db, log_id):
    from backend.core.period_dates import pay_month_of
    from backend.models import WorkLogEntry
    return pay_month_of(db.query(WorkLogEntry.entry_date).filter_by(work_log_id=log_id).order_by(WorkLogEntry.entry_date).first()[0])


def get_file(api, user, query, expect=200):
    response = api.client.get(f"/finance-pack/download?{query}", headers=bearer(api, user))
    assert response.status_code == expect, response.text[:300]
    return response


def test_regional_finance_payroll_downloads_by_region_facility_and_person(api, db, period, v22):
    rf = v22["finance"]
    for user in (rf, "csofin1", "fhifin1"):
        all_cadres(db, user)
    log = approve_to_regional_finance(api, prepare(api, db, period, v22, "chw1", "PAYROLL"), rf)
    month, placement = month_of(db, log["id"]), db.get(StaffAssignment, log["assignment_id"])
    region, facility = placement.region_id, placement.facility_id
    options = api.get("/finance-pack/options", rf)
    assert options["work_types"] == ["PAYROLL", "SERVICES"] and region in {r["id"] for r in options["regions"]}
    assert facility in {f["id"] for f in api.get(f"/finance-pack/facilities?region_id={region}", rf)}

    state = {"staff_id": log["staff_id"], "scale": "PACK-" + uuid.uuid4().hex[:6]}
    with provider_details(db, state):
        api.call("PUT", "/salary-amounts", "fhifin1", {"scale": state["scale"], "start_month": month, "monthly_amount": "700000.00"})
        base = f"work_type=PAYROLL&month={month}&region_id={region}"
        summary = api.get(f"/finance-pack?{base}", rf)
        person = next(p for p in summary["people"] if p["staff_id"] == log["staff_id"])
        assert Decimal(person["amount"]) == 700000 and person["state"] == "Not sent to CSO" and person["activities"] >= 0
        assert "bank_account_number" not in person  # bank details are only in the files
        # One facility, one person.
        assert {p["staff_id"] for p in api.get(f"/finance-pack?{base}&facility_id={facility}", rf)["people"]} >= {log["staff_id"]}
        one = api.get(f"/finance-pack?{base}&staff_id={log['staff_id']}", rf)["people"]
        assert [p["staff_id"] for p in one] == [log["staff_id"]]

        for what, fmt, start in (("timesheets", "pdf", b"%PDF"), ("activities", "xlsx", b"PK"), ("activities", "pdf", b"%PDF"),
                                 ("summary", "xlsx", b"PK"), ("summary", "pdf", b"%PDF"), ("import", "xlsx", b"PK"), ("import", "csv", b"\xef\xbb\xbf")):
            assert get_file(api, rf, f"what={what}&format={fmt}&{base}&staff_id={log['staff_id']}").content.startswith(start)
        get_file(api, rf, f"what=timesheets&format=xlsx&{base}", expect=422)

        # Activity totals added up by person, facility, region, cadre or for everyone; and narrowed to one cadre.
        cadre_id = db.get(WorkLog, log["id"]).cadre_id
        for group in ("person", "facility", "region", "cadre", "all"):
            sheet = load_workbook(io.BytesIO(get_file(api, rf, f"what=activities&format=xlsx&{base}&group_by={group}").content)).active
            header = [c.value for c in sheet[1]]
            assert header == finance_pack.ACTIVITY_COLUMNS
            first = dict(zip(header, [c.value for c in sheet[2]]))
            assert first["Totals by"] == finance_pack.GROUPS[group] and first["Providers"] >= 1
            assert get_file(api, rf, f"what=activities&format=pdf&{base}&group_by={group}").content.startswith(b"%PDF")
        everyone = load_workbook(io.BytesIO(get_file(api, rf, f"what=activities&format=xlsx&{base}&group_by=all").content)).active
        assert {row[2] for row in everyone.iter_rows(min_row=2, values_only=True)} == {"All providers"}
        get_file(api, rf, f"what=activities&format=xlsx&{base}&group_by=district", expect=422)
        narrowed = api.get(f"/finance-pack?{base}&cadre_id={cadre_id}", rf)["people"]
        assert narrowed and all(p["cadre"] == narrowed[0]["cadre"] for p in narrowed)
        assert {c["id"] for c in api.get("/finance-pack/options", rf)["cadres"]} >= {cadre_id}

        # The import file: one header row, one row per person, plain values, account number as text.
        book = load_workbook(io.BytesIO(get_file(api, rf, f"what=import&format=xlsx&{base}&staff_id={log['staff_id']}").content))
        sheet = book.active
        header = [c.value for c in sheet[1]]
        assert header == finance_pack.IMPORT_COLUMNS["PAYROLL"] and sheet.max_row == 2
        row = dict(zip(header, [c.value for c in sheet[2]]))
        assert row["Staff ID"] == log["staff_id"] and row["Total amount"] == 700000 and row["Account number"] == "0123456789"
        assert row["Days filled"] >= 1 and row["Status"] == "Not sent to CSO"
        text = get_file(api, rf, f"what=import&format=csv&{base}&staff_id={log['staff_id']}").content.decode("utf-8-sig")
        assert list(csv.reader(io.StringIO(text)))[0] == finance_pack.IMPORT_COLUMNS["PAYROLL"]

    # Payroll is the CSO's and Services FHI360's: each payer gets only its own kind.
    assert api.get("/finance-pack/options", "fhifin1")["work_types"] == ["SERVICES"]
    assert api.get("/finance-pack/options", "csofin1")["work_types"] == ["PAYROLL"]
    api.get(f"/finance-pack?work_type=PAYROLL&month={month}&region_id={region}", "fhifin1", expect=403)
    api.get(f"/finance-pack?work_type=SERVICES&month={month}&region_id={region}", "csofin1", expect=403)
    api.get(f"/finance-pack?work_type=PAYROLL&month={month}&region_id={region}", "chw1", expect=403)


def test_regional_finance_sends_a_month_of_services_to_central_finance_at_once(api, db, empty_period, v22):
    rf = v22["finance"]
    first, _ = reviewed(api, db, empty_period, v22, "chw1")
    second, _ = reviewed(api, db, empty_period, v22, "hcp1")
    month, region = month_of(db, first["id"]), v22["region_id"]
    status = api.get(f"/finance/services-month?month={month}&region_id={region}", rf)
    ready = {row["work_log_id"] for row in status["ready"]}
    assert {first["id"], second["id"]} <= ready and status["counts"]["ready"] >= 2 and Decimal(status["ready_total"]) > 0
    reviewer = next(r for r in status["central_reviewers"] if r["username"] == "fhifin1")
    body = {"month": month, "region_id": region, "central_reviewer_id": reviewer["id"], "review_confirmed": True}
    api.post("/finance/services-month/send", rf, {**body, "review_confirmed": False}, expect=422)
    api.post("/finance/services-month/send", "csofin1", body, expect=403)
    result = api.post("/finance/services-month/send", rf, body)
    assert {first["id"], second["id"]} <= {row["work_log_id"] for row in result["sent"]}
    db.expire_all()
    for log_id in (first["id"], second["id"]):
        assert db.get(WorkLog, log_id).status == "ROUTED_FHI360"
        claim = db.query(PaymentClaim).filter_by(work_log_id=log_id).one()
        assert claim.status == "PENDING_CENTRAL_REVIEW" and claim.central_reviewer_id == reviewer["id"]
    after = api.get(f"/finance/services-month?month={month}&region_id={region}", rf)
    assert after["counts"]["ready"] == 0 and after["counts"]["sent"] >= 2
    api.post("/finance/services-month/send", rf, body, expect=409)  # nothing left to send

    # Regional Finance's Services download shows where each one stands; Central Finance's lists what it approved.
    people = api.get(f"/finance-pack?work_type=SERVICES&month={month}&region_id={region}", rf)["people"]
    assert any(p["state"] == "Sent to Central Finance" and p["amount"] for p in people)
    for log_id in (first["id"], second["id"]):
        claim = db.query(PaymentClaim).filter_by(work_log_id=log_id).one()
        api.post(f"/claims/{claim.id}/actions/central_approve", "fhifin1", {"review_confirmed": True, "expected_amount": float(claim.amount)})
    central = api.get(f"/finance-pack?work_type=SERVICES&month={month}&region_id={region}", "fhifin1")["people"]
    assert len(central) >= 2 and all(p["state"] == "Approved by Central Finance" for p in central)
    sheet = load_workbook(io.BytesIO(get_file(api, "fhifin1", f"what=import&format=xlsx&work_type=SERVICES&month={month}&region_id={region}").content)).active
    assert [c.value for c in sheet[1]] == finance_pack.IMPORT_COLUMNS["SERVICES"] and sheet.max_row >= 3
