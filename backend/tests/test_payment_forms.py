"""The EpiC / FHI360 payment form: Services for Central Finance (mobile wallet), signed Payroll for the CSO (bank)."""
import io
from decimal import Decimal

import pytest
from openpyxl import load_workbook

from backend.models import AuditEvent, PayPeriod, ServicesReportDownload, Staff, WorkLog
from backend.services import payment_forms
from .test_ctc_facility_approval import no_provider_sms
from .test_salary_timesheets import bearer, set_amount, setup, unsigned
from .test_services_finance_exports import route
from .test_services_without_budgets import empty_period
from .test_v22_finance import v22

pytestmark = pytest.mark.usefixtures("no_provider_sms")
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def table(content):
    """The form's column titles and data rows, as a reader of the workbook sees them."""
    sheet = load_workbook(io.BytesIO(content)).active
    rows = [[cell for cell in row] for row in sheet.iter_rows(min_row=7)]
    return [cell.value for cell in rows[0]], rows[1:], sheet


def test_services_payment_form_on_screen_and_as_pdf_and_excel(api, db, empty_period, v22):
    claim = route(api, db, empty_period, v22)
    staff = db.get(Staff, claim.staff_id)
    saved = (staff.mobile_money_number, staff.first_name)
    staff.mobile_money_number = "+255700000001"
    staff.first_name = "=FORMULA"
    db.commit()
    try:
        _services_form_checks(api, db, v22, claim, empty_period)
    finally:  # the provider is shared by later tests: give the name and number back
        db.rollback()
        staff.mobile_money_number, staff.first_name = saved
        db.commit()


def _services_form_checks(api, db, v22, claim, empty_period):
    month = empty_period["start_date"][:7]
    headers = bearer(api, "fhifin1")
    # Routed but not yet approved by Central Finance: not on the form, and the form says it is waiting.
    waiting = api.get(f"/finance/services-payment-form?month={month}", "fhifin1")
    assert waiting["rows"] == [] and waiting["awaiting_central_review"]["claims"] == 1
    assert Decimal(waiting["awaiting_central_review"]["amount"]) == 40000
    early = api.client.get(f"/finance/services-payment-report/export?month={month}&format=pdf", headers=headers)
    assert early.status_code == 404 and "awaits Central Finance approval" in early.text
    assert api.client.get(f"/finance/services-payment-report/export?month={month}&format=csv", headers=headers).status_code == 200
    api.post(f"/claims/{claim.id}/actions/central_approve", "fhifin1", {"review_confirmed": True, "expected_amount": 40000})
    form = api.get(f"/finance/services-payment-form?month={month}", "fhifin1")
    assert form["awaiting_central_review"]["claims"] == 0
    assert form["columns"] == payment_forms.SERVICES_COLUMNS and "report_rows" not in form
    assert form["activity"].startswith("Services payments - ") and form["venue"]
    row = form["rows"][0]
    assert (row["sn"], row["days"], Decimal(row["subtotal"]), Decimal(row["total"])) == (1, 1, 40000, 40000)
    assert row["mobile"] == "+255•••001" and row["services"] and row["claim_id"] == claim.id  # on screen: last digits only
    assert {k: Decimal(v) for k, v in form["totals"].items()} == {"TZS": 40000}

    for fmt, media, start in (("pdf", "application/pdf", b"%PDF"), ("xlsx", XLSX, b"PK")):
        response = api.client.get(f"/finance/services-payment-report/export?month={month}&format={fmt}", headers=headers)
        assert response.status_code == 200, response.text
        assert media in response.headers["content-type"] and response.content.startswith(start)
        assert f"services-payment-form-{month}.{fmt}" in response.headers["content-disposition"]
        # A PRF can be recorded against the form, as against the CSV: the download names exactly these claims.
        download = db.get(ServicesReportDownload, int(response.headers["x-download-id"]))
        assert download.format == fmt and download.claim_ids == [claim.id]
    titles, rows, sheet = table(response.content)
    assert titles == payment_forms.SERVICES_COLUMNS
    assert sheet["A3"].value == "PAYMENT FORM" and sheet["C4"].value == form["activity"]
    name = rows[0][1]
    assert name.value.startswith("=FORMULA") and name.data_type == "s"  # text, never a formula
    # The allowance is left blank for Finance; the total adds it as soon as it is typed in.
    # The Services summary: name, region, facility, days, what was done, total of all services, mobile number.
    assert rows[0][2].value and rows[0][3].value  # region and facility
    assert rows[0][2].value  # cadre
    assert rows[0][5].value == 1 and rows[0][6].value.endswith("(1 day)")  # each service with its paid days
    assert [cell.value for cell in rows[0][7:9]] == [40000, "+255700000001"]
    assert rows[-1][1].value == "TOTAL" and rows[-1][7].value == "=SUM(H8:H8)"
    assert sheet.auto_filter.ref == "A7:I8"

    for user in ("chw1", "csofin1", v22["finance"]):
        api.get(f"/finance/services-payment-form?month={month}", user, expect=403)


def test_cso_payroll_payment_form_shows_salary_and_bank_and_the_file_is_audited(api, db, v22, setup):
    set_amount(api, setup, "750000.00")
    query = f"cso_id={setup['organization_id']}&month={setup['month']}"
    form = api.get(f"/cso-finance/payment-form?{query}", "csofin1")
    assert form["columns"] == payment_forms.PAYROLL_COLUMNS
    assert "Monthly salary payments" in form["activity"] and form["venue"]
    row = form["rows"][0]
    assert Decimal(row["salary"]) == Decimal(row["subtotal"]) == Decimal(row["total"]) == 750000
    assert row["days"] == 1 and row["bank_name"] == "NMB" and row["bank_branch"] == "Iringa"
    assert row["bank_account_number"] == "•••• 6789"  # the full number is only in the audited file

    for fmt, start in (("pdf", b"%PDF"), ("xlsx", b"PK")):
        response = api.client.get(f"/cso-finance/payment-form/export?{query}&format={fmt}", headers=bearer(api, "csofin1"))
        assert response.status_code == 200, response.text
        assert response.content.startswith(start) and response.headers["cache-control"] == "no-store"
        audit = db.query(AuditEvent).filter_by(action="download_payment_form").order_by(AuditEvent.id.desc()).first()
        assert audit.after["format"] == fmt and audit.after["bank_details"] is True and audit.after["rows"] == 1
    titles, rows, _ = table(response.content)
    assert titles == payment_forms.PAYROLL_COLUMNS
    # Payroll summary: salary, days filled, total, bank name and account (no subtotal, allowance or branch).
    assert rows[0][2].value == "Data Clerk"  # cadre: the salary-file tests use a Data Clerk, paid by salary scale
    assert [cell.value for cell in rows[0][5:10]] == [750000, 1, 750000, "NMB", "0123456789"]
    assert rows[-1][1].value == "TOTAL" and rows[-1][7].value == f"=SUM(H8:H{len(rows) + 6})"

    api.get(f"/cso-finance/payment-form?{query}", "fhifin1", expect=403)
    api.get(f"/cso-finance/payment-form?{query}", "csofin3", expect=404)


def test_unsigned_payroll_has_no_payment_form(api, unsigned):
    query = f"cso_id={unsigned['organization_id']}&month={unsigned['month']}"
    assert api.get(f"/cso-finance/payment-form?{query}", "csofin1")["rows"] == []
    response = api.client.get(f"/cso-finance/payment-form/export?{query}&format=pdf", headers=bearer(api, "csofin1"))
    assert response.status_code == 404 and "Regional Finance signs the Payroll report first" in response.text


def test_only_finance_sees_the_salary_amount_on_a_payroll_timesheet(api, db, v22, setup):
    unsigned = setup  # any approved Payroll month will do; reuse it rather than use up another test month
    from backend.api.endpoints.worklogs import payroll_pay
    from backend.core.security import load_current_user
    from backend.models import User
    log = db.get(WorkLog, unsigned["log_id"])
    staff, period = db.get(Staff, log.staff_id), db.get(PayPeriod, log.period_id)
    actor = lambda name: load_current_user(db, db.query(User).filter_by(username=name).one())
    finance = actor(v22["finance"])
    assert payroll_pay(db, log, staff, period, finance)["monthly_salary"] is None  # no amount set for the scale yet
    set_amount(api, unsigned, "640000.00")
    for name in (v22["finance"], "fhifin1", "csofin1"):
        pay = payroll_pay(db, log, staff, period, actor(name))
        assert pay["amount_visible"] and Decimal(pay["monthly_salary"]) == 640000 and pay["salary_scale"] == unsigned["scale"]
    # CTC in-charge, Technical, RM and the provider approve or read the timesheet without the amount.
    for name in ("supervisor1", "tofficer1", "rpm1", "chw1"):
        pay = payroll_pay(db, log, staff, period, actor(name))
        assert pay == {"amount_visible": False, "salary_scale": unsigned["scale"]}
    log.work_type = "SERVICES"
    assert payroll_pay(db, log, staff, period, finance) is None
    db.rollback()


def test_a_salary_timesheet_pdf_too_large_asks_for_a_region(api, setup, monkeypatch):
    from backend.services import salary_timesheets
    query = f"cso_id={setup['organization_id']}&month={setup['month']}"
    monkeypatch.setattr(salary_timesheets, "MAX_PDF_PROVIDERS", 0)
    too_big = api.client.get(f"/cso-finance/salary-timesheets/export?{query}&format=pdf", headers=bearer(api, "csofin1"))
    assert too_big.status_code == 422 and "Choose a region" in too_big.json()["detail"]
    # Everyone is still in the CSV and the payment form.
    assert api.client.get(f"/cso-finance/salary-timesheets/export?{query}&format=csv", headers=bearer(api, "csofin1")).status_code == 200
    assert api.client.get(f"/cso-finance/payment-form/export?{query}&format=pdf", headers=bearer(api, "csofin1")).status_code == 200


def test_one_payment_instruction_per_claim_batch_or_payment_form(api, db, empty_period, v22):
    """A claim is paid from a batch or from a PRF payment form, never both: each keeps the other's claims out."""
    from .test_batch_reversal import exported
    from .test_payment_requests import prf
    month = empty_period["start_date"][:7]
    headers = bearer(api, "fhifin1")
    from backend.core.security import load_current_user
    from backend.models import User
    from backend.services import batches as bt
    actor = load_current_user(db, db.query(User).filter_by(username="fhifin1").one())

    def batch_ready():  # other tests share the database, so look at this claim, not the total
        db.expire_all()
        return {claim.id for claim in bt.ready_claims(db, actor, "A")}

    # In a batch: off the payment form, and not offered for another batch.
    batched, batch = exported(api, db, empty_period, v22)

    def on_form():  # an empty form (every claim batched, on a PRF or paid) answers 404
        response = api.client.get(f"/finance/services-payment-form?month={month}", headers=headers)
        return {r["claim_id"] for r in response.json()["rows"]} if response.status_code == 200 else set()
    assert batched not in on_form()
    assert batched not in batch_ready()
    # Undo the batch: the claim is back on the form and could be batched; once its PRF is recorded, it cannot.
    api.post(f"/batches/{batch['id']}/reverse", "fhifin1", {"reason": "Pay it from the PRF instead"})
    assert batched in on_form()
    assert batched in batch_ready()
    download = api.client.get(f"/finance/services-payment-report/export?month={month}&format=xlsx", headers=headers)
    assert download.status_code == 200
    prf(api, int(download.headers["x-download-id"]), "PRF-ONE-" + str(batched))
    assert batched not in batch_ready()
    assert isinstance(api.get("/batches/ready", "fhifin1")["A"], int)


@pytest.fixture
def readable_pdf(monkeypatch):
    """Uncompressed PDFs, so a test can read their text."""
    from reportlab import rl_config
    monkeypatch.setattr(rl_config, "pageCompression", 0)


def test_cso_pdf_has_each_timesheet_with_activity_totals_then_the_payment_form(api, setup, readable_pdf):
    set_amount(api, setup, "750000.00")
    query = f"cso_id={setup['organization_id']}&month={setup['month']}"
    pdf = api.client.get(f"/cso-finance/salary-timesheets/export?{query}&format=pdf", headers=bearer(api, "csofin1"))
    assert pdf.status_code == 200
    text = pdf.content
    assert b"All activities this month" in text and b"Clients served" in text and b"PAYROLL TIMESHEET" in text
    assert b"PAYMENT FORM" in text and text.index(b"Clients served") < text.index(b"PAYMENT FORM")  # the summary comes last
    assert b"PRIVATE-COMMENT" not in text and b"PRIVATE-EVIDENCE" not in text


def test_central_finance_gets_services_timesheets_then_the_payment_form(api, db, empty_period, v22, readable_pdf):
    claim = route(api, db, empty_period, v22)
    month = empty_period["start_date"][:7]
    headers = bearer(api, "fhifin1")
    pack = f"/finance/services-payment-report/export?month={month}&format=pdf&timesheets=true"
    assert api.client.get(pack, headers=headers).status_code == 404  # nothing approved by Central Finance yet
    api.post(f"/claims/{claim.id}/actions/central_approve", "fhifin1", {"review_confirmed": True, "expected_amount": 40000})
    response = api.client.get(pack, headers=headers)
    assert response.status_code == 200 and "services-timesheets-and-payment-form" in response.headers["content-disposition"]
    text = response.content
    assert b"Services timesheets" in text and f"Claim #{claim.id}".encode() in text
    assert b"SERVICES TIMESHEET" in text and b"Services delivered" in text and b"PAYROLL TIMESHEET" not in text
    assert b"PAYMENT FORM" in text and text.index(f"Claim #{claim.id}".encode()) < text.index(b"PAYMENT FORM")
    # The same claims as the payment form, so a PRF can be recorded from this download too.
    assert db.get(ServicesReportDownload, int(response.headers["x-download-id"])).claim_ids == [claim.id]


def test_a_services_batch_excel_opens_on_the_summary_to_pay_from(api, db, empty_period, v22):
    from .test_batch_reversal import exported
    claim_id, batch = exported(api, db, empty_period, v22)
    response = api.client.get(f"/batches/{batch['id']}/export.xlsx", headers=bearer(api, "fhifin1"))
    assert response.status_code == 200
    book = load_workbook(io.BytesIO(response.content))
    assert book.sheetnames == ["Summary", "Details"]
    summary = book["Summary"]
    assert summary["A3"].value == "PAYMENT FORM" and batch["reference"] in summary["C4"].value
    assert [cell.value for cell in summary[7]] == payment_forms.SERVICES_COLUMNS
    assert [cell.value for cell in summary[7]] == ["S/N", "Name", "Cadre", "Region", "Health facility", "No. of days", "Services summary",
                                                    "Total amount", "Mobile No. for (Mobile Wallet Payment)"]
    person = [cell.value for cell in summary[8]]
    # One row per person: a batch takes every ready Services claim, so a person's claims are added together.
    head = [cell.value for cell in book["Details"][1]]
    mine = [row for row in book["Details"].iter_rows(min_row=2, values_only=True) if row[head.index("staff_name")] == person[1]]
    assert person[0] == 1 and person[2] and person[3] and person[4] and person[5] >= 1 and person[8]
    assert "day" in person[6]  # the services summary: each service with its paid days
    assert person[7] == sum(row[head.index("amount")] for row in mine)  # the summary adds the details up
    last = summary.max_row
    assert summary.cell(last, 2).value == "TOTAL" and summary.cell(last, 8).value == f"=SUM(H8:H{last - 1})"
    details = [cell.value for cell in book["Details"][1]]
    assert "claim_id" in details and "budget_line" in details  # the full batch lines stay on the second sheet


def test_payroll_form_counts_every_day_filled_in_on_the_timesheet():
    provider = {"provider_name": "Asha Juma", "region_name": "Iringa", "facility_name": "Kidamali", "community_area_name": None,
                "cadre_name": "Community Health Worker", "monthly_salary": "750000.00", "days": 22, "days_signed": 20,
                "bank_name": "NMB", "bank_account_number": "0123456789", "bank_branch": "Iringa", "checks": []}
    form = payment_forms.payroll_form({"month": "2026-10", "organization_name": "Demo CSO", "providers": [provider]})
    assert form["columns"] == ["S/N", "Name", "Cadre", "Region", "Health facility", "Monthly salary", "No. of days filled",
                               "Total amount", "Bank name", "Account number"]
    row = form["rows"][0]
    assert (row["name"], row["cadre"], row["region"], row["facility"], row["days"]) == ("Asha Juma", "Community Health Worker", "Iringa", "Kidamali", 22)


def test_a_long_services_summary_lists_one_service_per_line_most_days_first():
    """Seven services: every one is listed, one per line with its days, so the lines add up to "No. of days"."""
    services = ["Index testing outreach", "SNS-RNR testing outreach", "TB contact tracing", "Special and weekend clinics",
                "Community TB active case finding", "Outreach services", "Weekend clinic data entry"]
    breakdown = [{"service": s, "paid": d, "amount": "0"} for s, d in zip(services, [1, 3, 2, 2, 4, 1, 1])]
    breakdown += [{"service": "Outreach services", "paid": 1, "amount": "0"}, {"service": "Unpaid shortfall", "paid": 0}]
    lines = payment_forms.summary_lines(breakdown)
    assert lines[0] == ["Community TB active case finding", 4] and lines[1] == ["SNS-RNR testing outreach", 3]
    assert len(lines) == 7 and sum(days for _, days in lines) == 15  # the same service twice is counted once, unpaid left out
    text = payment_forms.services_summary(breakdown)
    assert text.splitlines()[0] == "Community TB active case finding (4 days)" and text.count("\n") == 6
    assert "Weekend clinic data entry (1 day)" in text.splitlines()

    rows = [{"sn": 1, "name": "Janeth Mandepu", "cadre": "Health Care Provider", "region": "Njombe", "facility": "Kifanya Dispensary",
             "days": 15, "summary": text, "summary_lines": lines, "subtotal": "150000", "total": "150000", "currency": "TZS",
             "mobile": "+255710000003"}]
    form = {"kind": "SERVICES", "month": "2026-10", "activity": "Services payments - October 2026", "venue": "Njombe",
            "columns": payment_forms.SERVICES_COLUMNS, "rows": rows, "totals": {"TZS": "150000"}}
    assert payment_forms.pdf_file(form).startswith(b"%PDF")
    sheet = load_workbook(io.BytesIO(payment_forms.xlsx_file(form))).active
    cell = sheet.cell(8, payment_forms.SERVICES_COLUMNS.index("Services summary") + 1)
    assert cell.value == text and cell.alignment.wrap_text
    assert sheet.row_dimensions[8].height >= 13 * 7  # tall enough to show every line


def _many(facilities=3, each=4):
    """A Services form for many people in several facilities, as Central Finance downloads it for a whole region."""
    rows, sn = [], 0
    for f in range(facilities):
        for i in range(each):
            sn += 1
            days = 1 + (i % 3)
            rows.append({"sn": sn, "name": f"Person {sn:03d}", "cadre": "Community Health Worker", "region": "Njombe",
                         "facility": f"Facility {f + 1}", "days": days, "summary": f"Outreach services ({days} days)",
                         "summary_lines": [["Outreach services", days]], "subtotal": str(days * 20000), "total": str(days * 20000),
                         "currency": "TZS", "mobile": f"+2557100{sn:05d}"})
    total = sum(int(r["total"]) for r in rows)
    return {"kind": "SERVICES", "month": "2026-10", "activity": "Services payments - October 2026", "venue": "Njombe",
            "columns": payment_forms.SERVICES_COLUMNS, "rows": rows, "totals": {"TZS": str(total)}}


def test_a_form_for_many_people_has_a_facility_summary_subtotals_and_page_n_of_m(readable_pdf):
    import re
    form = _many(facilities=3, each=150)  # 450 people: several pages
    pdf = payment_forms.pdf_file(form)
    count = len(re.findall(rb"/Type /Page\b(?!s)", pdf))
    assert count > 3
    assert all(f"Page {n} of {count}".encode() in pdf for n in range(1, count + 1))
    assert pdf.index(b"Summary by health facility") < pdf.index(b"TOTAL \\(3 facilities\\)") < pdf.index(b"Person 001")
    for f in (1, 2, 3):
        assert f"Subtotal: Facility {f}, Njombe \\(150 people\\)".encode() in pdf
    assert b"TOTAL \\(450 people\\)" in pdf and b"18,000,000" in pdf  # 450 people, 900 days at 20,000
    assert b"/MediaBox [ 0 0 841.8898 595.2756 ]" in pdf  # landscape A4: one person per line

    book = load_workbook(io.BytesIO(payment_forms.xlsx_file(form)))
    assert book.sheetnames == ["Payment form", "By facility"]
    main = book["Payment form"]
    assert main.max_row == 7 + 450 + 1 and main.freeze_panes == "A8"  # one row per person, no subtotal rows to break filters
    assert main.cell(main.max_row, 6).value == "=SUM(F8:F457)" and main.cell(main.max_row, 8).value == "=SUM(H8:H457)"
    by = [row for row in book["By facility"].iter_rows(min_row=4, values_only=True)]
    assert by[:3] == [("Njombe", f"Facility {f}", 150, 300, 6000000.0) for f in (1, 2, 3)]
    assert by[3][1] == "TOTAL (3 facilities)" and by[3][4] == "=SUM(E4:E6)"


def test_a_form_for_one_facility_has_no_subtotals(readable_pdf):
    form = _many(facilities=1, each=5)
    pdf = payment_forms.pdf_file(form)
    assert b"Subtotal" not in pdf and b"Summary by health facility" not in pdf and b"TOTAL \\(5 people\\)" in pdf
    assert load_workbook(io.BytesIO(payment_forms.xlsx_file(form))).sheetnames == ["Payment form"]
