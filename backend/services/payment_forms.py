"""The EpiC / FHI360 payment form: one row per person, as Finance prints and signs it.

Central Finance gets it for routed Services (paid to a mobile wallet), CSO Finance for signed Payroll (paid to a bank).
Services: name, region, facility, days paid, total of all services, mobile number. Payroll: name, region, facility,
monthly salary, days filled in on the timesheet, total, bank name and account. A form is a document only: it never
pays or changes a record."""
import io
from calendar import month_name
from decimal import Decimal
from html import escape
from pathlib import Path

from openpyxl import Workbook
from openpyxl.drawing.image import Image as SheetImage
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from . import services_finance_exports as services
from .salary_timesheets import OTHER_ROW

BRAND = Path(__file__).resolve().parents[2] / "frontend" / "public" / "brand"
# Shown when present. The EpiC logo is not in the repository yet: add frontend/public/brand/epic-logo.png to print it.
LOGOS = ("usa-mark.png", "epic-logo.png", "fhi360-logo.png")
PROJECT = "EpiC PROJECT"
# The Services summary Central Finance pays from: one row per person, all services added together.
SERVICES_COLUMNS = ["S/N", "Name", "Cadre", "Region", "Health facility", "No. of days", "Total amount",
                    "Mobile No. for (Mobile Wallet Payment)"]
# Payroll counts every day filled in on the timesheet (Services counts the days paid).
PAYROLL_COLUMNS = ["S/N", "Name", "Cadre", "Region", "Health facility", "Monthly salary", "No. of days filled",
                   "Total amount", "Bank name", "Account number"]
MONEY = {"Monthly salary", "Total amount"}
# Where the printed header breaks, so long titles wrap between words.
HEADER_LINES = {"Mobile No. for (Mobile Wallet Payment)": "Mobile No. for<br/>(Mobile Wallet<br/>Payment)"}


def month_text(month):
    year, number = month.split("-")
    return f"{month_name[int(number)]} {year}"


def joined(names):
    names = sorted({name for name in names if name})
    return ", ".join(names[:-1]) + " and " + names[-1] if len(names) > 1 else "".join(names)


def services_form(db, current, month, region_id=None, include_prf=False):
    """Routed Services, one row per claim: the services, the days paid and the amount, paid to the wallet number."""
    from ..models import PaymentClaim
    from .central_review import PENDING as AWAITING_CENTRAL
    everything = services.rows(db, current, month, region_id, include_prf)
    claims = {cid: (state, batch) for cid, state, batch in db.query(PaymentClaim.id, PaymentClaim.status, PaymentClaim.batch_id).filter(
        PaymentClaim.id.in_({row[services.CLAIM_ID] for row in everything} or {-1}))}
    status = {cid: state for cid, (state, _) in claims.items()}
    # A payment form is signed and paid from: only claims Central Finance has approved are on it, and not a claim
    # already in a payment batch, which is paid from that batch (one payment instruction per claim).
    report = [row for row in everything if status.get(row[services.CLAIM_ID]) != AWAITING_CENTRAL
              and not claims.get(row[services.CLAIM_ID], (None, None))[1]]
    waiting = {row[services.CLAIM_ID]: Decimal(0) for row in everything if status.get(row[services.CLAIM_ID]) == AWAITING_CENTRAL}
    for row in everything:
        if row[services.CLAIM_ID] in waiting:
            waiting[row[services.CLAIM_ID]] += Decimal(row[6])
    from ..models import Cadre, WorkLog
    cadres = dict(db.query(PaymentClaim.id, Cadre.name).join(WorkLog, WorkLog.id == PaymentClaim.work_log_id)
                  .join(Cadre, Cadre.id == WorkLog.cadre_id).filter(PaymentClaim.id.in_({row[services.CLAIM_ID] for row in report} or {-1})))
    people = {}
    for (region, facility, name, service, worked, paid, amount, currency, mobile, claim_id, *_rest) in report:
        person = people.setdefault(claim_id, {"name": name, "region": region, "facility": facility, "services": [],
                                              "days": 0, "amount": Decimal(0), "currency": currency, "mobile": mobile,
                                              "claim_id": claim_id, "cadre": cadres.get(claim_id, ""), "breakdown": []})
        person["breakdown"].append({"service": service, "worked": worked, "paid": paid, "amount": str(amount)})
        if paid:  # a service only listed for its monthly shortfall was not paid
            person["services"].append(service)
            person["days"] += paid
            person["amount"] += Decimal(amount)
    rows = [{**p, "services": ", ".join(p["services"]) or "—"} for p in people.values() if p["amount"] or p["days"]]
    return {
        "kind": "SERVICES", "month": month,
        "activity": f"Services payments - {month_text(month)}",
        "venue": joined(r["region"] for r in rows), "columns": SERVICES_COLUMNS,
        "rows": [{"sn": i, "name": r["name"], "cadre": r["cadre"], "region": r["region"], "facility": r["facility"],
                  "services": r["services"], "breakdown": r["breakdown"],
                  "days": r["days"], "subtotal": str(r["amount"]), "total": str(r["amount"]), "currency": r["currency"],
                  "mobile": r["mobile"] or "", "claim_id": r["claim_id"]} for i, r in enumerate(rows, start=1)],
        "totals": _totals(rows, "amount"),
        # Routed but not yet approved by Central Finance: left off the form until approved.
        "awaiting_central_review": {"claims": len(waiting), "amount": str(sum(waiting.values(), Decimal(0)))},
        "report_rows": report,  # kept for the download record; never sent to the screen
    }


def payroll_form(result):
    """A CSO's signed Payroll: the monthly salary once per person, paid to their bank account."""
    rows = []
    for p in result["providers"]:
        salary = None if OTHER_ROW in p["checks"] else p["monthly_salary"]
        rows.append({"name": p["provider_name"], "region": p["region_name"],
                     "facility": p["community_area_name"] if p["facility_name"] in ("—", "Not assigned") and p["community_area_name"] else p["facility_name"],
                     "cadre": p["cadre_name"], "salary": salary, "days": p["days"],
                     "subtotal": salary, "total": salary, "currency": "TZS",
                     "bank_name": p["bank_name"] or "", "bank_account_number": p["bank_account_number"] or "",
                     "bank_branch": p["bank_branch"] or "", "checks": p["checks"]})
    cadres = joined(r["cadre"] for r in rows)
    return {
        "kind": "PAYROLL", "month": result["month"],
        "activity": f"{cadres + ' ' if cadres else ''}Monthly salary payments - {result['organization_name']} - {month_text(result['month'])}",
        "venue": joined(r["region"] for r in rows), "columns": PAYROLL_COLUMNS,
        "rows": [{"sn": i, **r} for i, r in enumerate(rows, start=1)],
        "totals": _totals(rows, "total"),
    }


def _totals(rows, key):
    totals = {}
    for row in rows:
        if row[key] is not None:
            totals[row["currency"]] = totals.get(row["currency"], Decimal(0)) + Decimal(str(row[key]))
    return {currency: str(total) for currency, total in totals.items()}


def screen(form):
    return {key: value for key, value in form.items() if key != "report_rows"}


def money(value):
    if value in (None, ""):
        return ""
    amount = Decimal(str(value))
    return f"{amount:,.0f}" if amount == amount.to_integral_value() else f"{amount:,.2f}"


def cells(form, row):
    """A row in the column order of the form."""
    if form["kind"] == "SERVICES":
        return [row["sn"], row["name"], row.get("cadre") or "", row["region"], row["facility"], row["days"], money(row["total"]), row["mobile"]]
    missing = "Salary on other row" if OTHER_ROW in row["checks"] else "Missing"
    return [row["sn"], row["name"], row.get("cadre") or "", row["region"], row["facility"], money(row["salary"]) or missing, row["days"],
            money(row["total"]), row["bank_name"] or "Missing", row["bank_account_number"] or "Missing"]


def total_text(form):
    if len(form["totals"]) == 1:  # one currency: the number alone, as on the paper form
        return money(next(iter(form["totals"].values())))
    return "; ".join(f"{currency} {money(total)}" for currency, total in sorted(form["totals"].items())) or "0"


def pdf_file(form):
    page = landscape(A4) if form["kind"] == "PAYROLL" else A4
    output = io.BytesIO()
    SimpleDocTemplate(output, pagesize=page, leftMargin=24, rightMargin=24, topMargin=24, bottomMargin=30,
                      title=f"Payment form {form['month']}").build(
        form_flowables(form, page[0] - 48), onFirstPage=_page_number, onLaterPages=_page_number)
    return output.getvalue()


def form_flowables(form, width):
    """The payment form as PDF content of a given width: alone, or as the last pages after the staff timesheets."""
    payroll = form["kind"] == "PAYROLL"
    styles = getSampleStyleSheet()
    body = ParagraphStyle("form", parent=styles["BodyText"], fontSize=7.5, leading=9)
    head = ParagraphStyle("formhead", parent=body, fontName="Helvetica-Bold", alignment=1)
    right = ParagraphStyle("formright", parent=body, alignment=2)
    big = ParagraphStyle("formbig", parent=body, fontName="Helvetica-Bold", fontSize=13, leading=16)
    center = ParagraphStyle("formcenter", parent=body, fontName="Helvetica-Bold", fontSize=9, leading=11, alignment=1)

    def p(value, style=body):
        return Paragraph(escape(str(value)), style)

    logos = []
    for name in LOGOS:
        path = BRAND / name
        if path.is_file():
            image = Image(str(path))
            scale = 34 / image.imageHeight
            image.drawHeight, image.drawWidth = 34, min(image.imageWidth * scale, 110)
            logos.append(image)
    top = Table([[p(PROJECT, big), *logos]], colWidths=[width * 0.34] + [width * 0.66 / max(len(logos), 1)] * len(logos))
    top.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("ALIGN", (1, 0), (-1, 0), "CENTER")]))
    header = Table([
        [top],
        [p("PAYMENT FORM", center)],
        [Table([[p("ACTIVITY:", head), p(form["activity"], center)]], colWidths=[width * 0.25, width * 0.75 - 12],
               style=TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.black)]))],
        [p(f"Venue: {form['venue']}", center)],
    ], colWidths=[width])
    header.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.8, colors.black),
                                ("LINEBELOW", (0, 2), (0, 2), 0.5, colors.black)]))

    numeric = {i for i, c in enumerate(form["columns"]) if c in MONEY or c in ("S/N", "No. of days", "No. of days filled")}
    data = [[Paragraph(HEADER_LINES.get(c, escape(c)), head) for c in form["columns"]]]
    data += [[p(v, right if i in numeric else body) for i, v in enumerate(cells(form, row))] for row in form["rows"]]
    total_at = form["columns"].index("Total amount")
    data.append([p("") for _ in form["columns"]])
    data[-1][total_at] = p(total_text(form), ParagraphStyle("total", parent=right, fontName="Helvetica-Bold"))
    data[-1][1] = p("TOTAL", ParagraphStyle("totallabel", parent=body, fontName="Helvetica-Bold"))
    shares = ([22, 100, 80, 55, 100, 65, 40, 65, 75, 85] if payroll else [22, 110, 85, 65, 110, 40, 70, 90])
    widths = [width * s / sum(shares) for s in shares]
    table = Table(data, colWidths=widths, repeatRows=1)
    table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.black),
                               ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#efefef")),
                               ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                               ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3)]))
    note = ("Approved does not mean paid. Total amount is all of the person's services for the period." if not payroll else
            "Signed Payroll from the Regional Finance sign-off. Approved does not mean paid. "
            "Total amount is the monthly salary.")
    return [header, Spacer(1, 6), table, Spacer(1, 6), p(note)]


def _page_number(canvas, document):
    """A form of thousands of people runs to hundreds of pages: each says which page it is and what it belongs to."""
    canvas.saveState()
    canvas.setFont("Helvetica", 7)
    canvas.drawString(document.leftMargin, 14, f"Payment form · {document.title.removeprefix('Payment form ')}")
    canvas.drawRightString(document.pagesize[0] - document.rightMargin, 14, f"Page {document.page}")
    canvas.restoreState()


def xlsx_file(form):
    output = io.BytesIO()
    workbook(form).save(output)
    return output.getvalue()


def workbook(form):
    """The same form as a workbook: logos and title on top, the table, and a total under Total amount."""
    book = Workbook()
    sheet = book.active
    sheet.title = "Payment form"
    columns = form["columns"]
    last = len(columns)
    thin = Side(style="thin", color="000000")
    box = Border(left=thin, right=thin, top=thin, bottom=thin)
    bold = Font(bold=True)
    sheet.row_dimensions[1].height = 42
    sheet.cell(1, 1, PROJECT).font = Font(bold=True, size=14)
    anchor = 4
    for name in LOGOS:
        path = BRAND / name
        if path.is_file():
            image = SheetImage(str(path))
            image.height, image.width = 50, min(image.width * 50 / image.height, 150)
            sheet.add_image(image, sheet.cell(1, anchor).coordinate)
            anchor += 2
    for row, text in ((3, "PAYMENT FORM"), (5, f"Venue: {form['venue']}")):
        sheet.merge_cells(start_row=row, start_column=1, end_row=row, end_column=last)
        cell = sheet.cell(row, 1, text)
        cell.font, cell.alignment = bold, Alignment(horizontal="center")
    sheet.cell(4, 2, "ACTIVITY:").font = bold
    sheet.merge_cells(start_row=4, start_column=3, end_row=4, end_column=last)
    sheet.cell(4, 3, form["activity"]).alignment = Alignment(horizontal="center")
    first = 7
    for index, title in enumerate(columns, start=1):
        cell = sheet.cell(first, index, title)
        cell.font, cell.border = bold, box
        cell.fill = PatternFill("solid", fgColor="EFEFEF")
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    sheet.row_dimensions[first].height = 45
    money_columns = {i for i, c in enumerate(columns, start=1) if c in MONEY}
    total_letter = sheet.cell(first, columns.index("Total amount") + 1).column_letter
    for offset, row in enumerate(form["rows"], start=1):
        values = cells(form, row)
        for index, value in enumerate(values, start=1):
            if index in money_columns:  # amounts are numbers, so Excel can add them; a missing one stays a note
                raw = {"Monthly salary": row.get("salary"), "Total amount": row["total"]}.get(columns[index - 1])
                value = float(Decimal(str(raw))) if raw not in (None, "") else values[index - 1]
            cell = sheet.cell(first + offset, index, value)
            if isinstance(value, str) and value.startswith("="):
                cell.data_type = "s"  # a name or number typed as =... stays text, never a formula
            cell.border = box
            if index in money_columns:
                cell.number_format = "#,##0"
    end = first + len(form["rows"]) + 1
    for index in range(1, last + 1):
        sheet.cell(end, index).border = box
    sheet.cell(end, 2, "TOTAL").font = bold
    total_column = columns.index("Total amount") + 1
    if len(form["totals"]) <= 1:
        total = sheet.cell(end, total_column, f"=SUM({total_letter}{first + 1}:{total_letter}{end - 1})")
        total.number_format = "#,##0"
    else:
        total = sheet.cell(end, total_column, total_text(form))
    total.font = bold
    widths = {"S/N": 5, "Name": 28, "Cadre": 22, "Region": 13, "Health facility": 28, "Services": 26, "No. of days": 8, "No. of days filled": 9,
              "Monthly salary": 13, "Total amount": 14,
              "Mobile No. for (Mobile Wallet Payment)": 18, "Bank name": 16, "Account number": 18, "Bank branch": 14}
    for index, title in enumerate(columns, start=1):
        sheet.column_dimensions[sheet.cell(first, index).column_letter].width = widths.get(title, 14)
    sheet.freeze_panes = sheet.cell(first + 1, 1)
    # Filter buttons on the header: thousands of rows can be narrowed to one region or facility.
    sheet.auto_filter.ref = f"A{first}:{sheet.cell(first, last).column_letter}{end - 1}"
    sheet.page_setup.orientation = "landscape" if form["kind"] == "PAYROLL" else "portrait"
    sheet.page_setup.fitToWidth, sheet.page_setup.fitToHeight = 1, 0
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.print_title_rows = f"{first}:{first}"
    return book



def services_pack_pdf(db, current, form, month, region_id=None):
    """Central Finance's Services document: each person's timesheet (attendance, services, activity month totals),
    then the Services payment form as the last pages. Exactly the people on the form."""
    from collections import defaultdict
    from reportlab.platypus import PageBreak
    from ..core.period_dates import pay_month_range
    from ..models import PaymentClaim
    from . import public_holidays
    from .finance_reports import monthly_summary
    from .salary_timesheets import NOT_PAYMENT, _footer, month_title, timesheet_page

    staff_of = dict(db.query(PaymentClaim.id, PaymentClaim.staff_id).filter(
        PaymentClaim.id.in_([row["claim_id"] for row in form["rows"]] or [-1])))
    placements = defaultdict(list)
    for item in monthly_summary(db, current, month, region_id, "SERVICES", daily=True)["providers"]:
        placements[item["staff_id"]].append(item)
    holidays = public_holidays.between(db, *pay_month_range(month))
    styles = getSampleStyleSheet()
    body = ParagraphStyle("pack", parent=styles["BodyText"], fontSize=8, leading=10)
    total = total_text(form)
    story = [Paragraph("Services timesheets", styles["Title"]),
             Paragraph(escape(f"{month_title(month)} | Venue: {form['venue']}"), styles["Heading3"]),
             Paragraph(escape(f"Providers: {len(form['rows'])} | Total amount: {total}"), styles["Heading3"]),
             Paragraph("Approved by Central Finance. Contents: one timesheet page per provider, then the payment form "
                       "(summary of all staff to pay) as the last pages. Approved does not mean paid.", body)]
    for row in form["rows"]:
        found = [item for item in placements.get(staff_of.get(row["claim_id"]), []) if item["region_name"] == row["region"]]
        provider = _merged(found) if found else {"cadre_name": "", "attendance": [], "hours": "0", "days": 0, "indicators": []}
        details = [
            (("Mkoa", "Region"), row["region"]), (("Kituo", "Facility"), row["facility"]),
            (("Jina", "Name"), row["name"]), (("Kada", "Cadre"), provider.get("cadre_name")),
            (("Huduma", "Services"), row["services"]), (("Simu ya malipo", "Mobile wallet"), row["mobile"] or "Missing"),
            (("Siku za kulipwa", "Days paid"), row["days"]), (("Kiasi", "Amount"), f"{row['currency']} {money(row['total'])}"),
        ]
        footer = [f"Claim #{row['claim_id']} · approved by Central Finance", NOT_PAYMENT.replace("salary", "Services")]
        story += [PageBreak(), *timesheet_page(provider, month, holidays, details, footer, heading=provider.get("cadre_name") or "Services",
                                               kind="SERVICES", services=row.get("breakdown"))]
    story += [PageBreak(), *form_flowables(form, landscape(A4)[0] - 56)]
    output = io.BytesIO()
    SimpleDocTemplate(output, pagesize=landscape(A4), topMargin=28, bottomMargin=28, leftMargin=28, rightMargin=28,
                      title=f"Services timesheets {month}").build(story, onFirstPage=_footer, onLaterPages=_footer)
    return output.getvalue()


def _merged(items):
    """One person working two placements in a region: one page, attendance and activity totals added together."""
    if len(items) == 1:
        return items[0]
    days, indicators = {}, {}
    for item in items:
        for day in item.get("attendance", []):
            seen = days.setdefault(day["date"], {**day, "hours": Decimal(0)})
            seen["hours"] += Decimal(str(day["hours"]))
            seen["start"] = min(filter(None, (seen["start"], day["start"])), default=None)
            seen["end"] = max(filter(None, (seen["end"], day["end"])), default=None)
        for indicator in item.get("indicators", []):
            seen = indicators.setdefault(indicator["key"], {**indicator, "total": Decimal(0)})
            seen["total"] += Decimal(str(indicator["total"]))
    return {**items[0], "attendance": [days[key] for key in sorted(days)], "days": len(days),
            "hours": str(sum((Decimal(str(item["hours"])) for item in items), Decimal(0))),
            "indicators": [indicators[key] for key in sorted(indicators)]}


def batch_services_form(db, batch, lines):
    """A Services (Route A) batch as the summary Central Finance pays from: one row per person, all services added
    together, the days paid and the mobile wallet number."""
    from ..models import PaymentClaim, Staff
    from .provider_payment_details import details
    claims = {claim.id: claim for claim in db.query(PaymentClaim).filter(
        PaymentClaim.id.in_([line["claim_id"] for line in lines] or [-1]))}
    staff = {person.id: person for person in db.query(Staff).filter(Staff.id.in_({line["staff_id"] for line in lines} or {-1}))}
    from ..models import Cadre
    cadre_names = dict(db.query(Cadre.code, Cadre.name))
    people = {}
    for line in lines:
        claim = claims.get(line["claim_id"])
        paid_days = {item["date"] for item in ((claim.calculation_snapshot or {}).get("lines", []) if claim else []) if item.get("date")}
        person = staff.get(line["staff_id"])
        mobile = (details(person)["mobile_money_number"] or person.verified_phone) if person else line.get("phone", "")
        row = people.setdefault(line["staff_id"], {"name": line["staff_name"], "region": line["region"],
                                                   "cadre": cadre_names.get(line.get("cadre"), line.get("cadre", "")),
                                                   "facility": line["facility"] or "Community / no facility",
                                                   "days": set(), "amount": Decimal(0), "currency": line["currency"],
                                                   "mobile": mobile or ""})
        row["days"] |= paid_days
        row["amount"] += Decimal(str(line["amount"]))
    rows = sorted(people.values(), key=lambda r: (r["region"], r["facility"], r["name"]))
    return {
        "kind": "SERVICES", "month": batch.reference,
        "activity": f"Services payments - batch {batch.reference}",
        "venue": joined(r["region"] for r in rows), "columns": SERVICES_COLUMNS,
        "rows": [{"sn": i, "name": r["name"], "cadre": r["cadre"], "region": r["region"], "facility": r["facility"], "days": len(r["days"]),
                  "subtotal": str(r["amount"]), "total": str(r["amount"]), "currency": r["currency"], "mobile": r["mobile"]}
                 for i, r in enumerate(rows, start=1)],
        "totals": _totals([{"total": r["amount"], "currency": r["currency"]} for r in rows], "total"),
    }


def batch_services_xlsx(db, batch, lines):
    """Sheet 1: the summary to pay from. Sheet 2: the batch's full details."""
    from .batches import write_details
    book = workbook(batch_services_form(db, batch, lines))
    book.active.title = "Summary"
    details = book.create_sheet()
    write_details(details, batch, lines)
    details.title = "Details"
    output = io.BytesIO()
    book.save(output)
    return output.getvalue()
