"""Signed Payroll timesheets a CSO downloads to pay salaries. Files only: they never pay or change a record."""
import csv
import io
from calendar import month_name
from datetime import timedelta
from decimal import Decimal
from html import escape

from fastapi import HTTPException
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from ..core.period_dates import pay_month_range
from ..models import Cadre, Region, Staff
from . import monthly_report_approval as reports
from . import public_holidays
from .monthly_report_exports import _cell, hours_text
from .provider_payment_details import details
from .salary_amounts import amounts_for

WEEKDAYS_SW = ("Jtt", "Jnn", "Jtn", "Alh", "Ijm", "Jms", "Jpl")  # Monday first, as date.weekday() counts
NO_DAILY_TIMES = "Daily times are not stored in this older sign-off. Totals are correct."
NOT_PAYMENT = "Documentation for salary payment. Approval is not payment."
BANK_MISSING = "Bank details missing"
SALARY_MISSING = "Salary amount missing"
NOT_SIGNED = "Provider has not signed this timesheet"
OTHER_ROW = "Salary is on this provider's other row"
OTHER_CSO = "Also on another CSO's file this month: check before paying"
FACILITY, COMMUNITY, NOT_ASSIGNED = "Facility", "Community", "Not assigned"
# The timesheet PDF has a page per provider: 1,000 builds in about 10 seconds; more is split by region.
MAX_PDF_PROVIDERS = 1000
# The CSO's on-screen list. Bank details and daily times stay in the downloaded, audited file.
SCREEN_FIELDS = ("staff_id", "provider_name", "cadre_name", "facility_name", "community_area_name", "work_setting",
                 "region_name", "days_signed", "monthly_salary", "checks")




def month_title(month):
    year, number = month.split("-")
    start, end = pay_month_range(month)
    return f"{month_name[int(number)]} {year} ({start:%d %b %Y} to {end:%d %b %Y})"


def amount_text(value):
    return f"TZS {Decimal(value):,.2f}" if value is not None else "Missing"


def work_setting(row):
    """A community area on the placement means community work, even when a facility is also linked."""
    if row.get("community_area_name"):
        return COMMUNITY
    return NOT_ASSIGNED if row["facility_name"] == NOT_ASSIGNED else FACILITY


def setting_totals(providers):
    """Facility and community side by side. A provider working in both counts once in each; their salary counts once."""
    result = []
    for name in (FACILITY, COMMUNITY, NOT_ASSIGNED):
        rows = [p for p in providers if p["work_setting"] == name]
        if rows:
            result.append({"name": name, "providers": len({p["staff_id"] for p in rows}),
                           "salary": str(sum((Decimal(p["monthly_salary"]) for p in rows if p["monthly_salary"]), Decimal(0)))})
    return result


def with_payment(rows, people, amounts):
    """Add salary and bank details. A provider's full monthly salary appears once, however many placements they have."""
    paid = set()
    for row in rows:
        person = people[row["staff_id"]]
        bank = details(person)
        signed_days = row.get("days_signed", row["days"])  # sign-offs from before this was saved: RM needs a signed log
        amount = amounts.get((row.get("salary_scale") or person.salary_scale or "").strip())
        checks = []
        if row["staff_id"] in paid:
            amount = None
            checks.append(OTHER_ROW)
        elif not signed_days:
            amount = None
            checks.append(NOT_SIGNED)
        elif amount is None:
            checks.append(SALARY_MISSING)
        else:
            paid.add(row["staff_id"])
        if not all(bank[key] for key in ("bank_name", "bank_account_number", "bank_branch")):
            checks.append(BANK_MISSING)
        if row.get("other_cso"):
            checks.append(OTHER_CSO)
        setting = work_setting(row)
        row.update(work_setting=setting, community_area_name=row.get("community_area_name"),
                   facility_name="—" if setting == COMMUNITY and row["facility_name"] == NOT_ASSIGNED else row["facility_name"],
                   days_signed=signed_days, salary_scale=row.get("salary_scale") or person.salary_scale,
                   monthly_salary=str(amount) if amount is not None else None, checks=checks,
                   bank_name=bank["bank_name"], bank_account_number=bank["bank_account_number"], bank_branch=bank["bank_branch"])


def signed(db, current, organization, month, region_id=None, setting=None):
    """Latest Regional Finance sign-off per region; unsigned work never appears here."""
    reports.check_month(month)
    allowed = reports.cso_regions(db, current)
    if region_id and region_id not in allowed:
        raise HTTPException(403, "This region is outside your assigned scope.")
    cadres = {c.code for c in db.query(Cadre).filter(Cadre.id.in_(current.review_cadres))}
    names = {r.id: r.name for r in db.query(Region).filter(Region.id.in_(allowed))}
    regions, rows = [], []
    for region in sorted(allowed, key=lambda value: names[value]):
        row = {"id": region, "name": names[region], "signed": False, "included": region_id in (None, region),
               "approved_by_name": None, "approved_at": None, "providers": 0, "providers_without_cso": 0}
        approved = reports.latest(db, month, region, "PAYROLL")
        if approved:
            published = approved.snapshot["organizations"].get(str(organization.id)) or {"providers": []}
            matching = [p for p in published["providers"] if p["cadre_code"] in cadres]
            others = {p["staff_id"] for org, report in approved.snapshot["organizations"].items() if org != str(organization.id) for p in report["providers"]}
            signature = {"approved_by_name": approved.snapshot["approved_by_name"],
                         "approved_at": approved.approved_at.date().isoformat()}
            # A placement with no CSO is in no CSO's copy, so say so rather than leave the person silently unpaid.
            placed = {p["staff_id"] for report in approved.snapshot["organizations"].values() for p in report["providers"]}
            without_cso = {p["staff_id"] for p in approved.snapshot["regional"]["providers"]
                           if p["cadre_code"] in cadres and p["staff_id"] not in placed}
            row.update(signed=True, providers=len(matching), providers_without_cso=len(without_cso), **signature)
            rows.extend({**p, **signature, "included": row["included"], "other_cso": p["staff_id"] in others} for p in matching)
        regions.append(row)
    rows.sort(key=lambda p: (p["region_name"], p["cadre_code"], p["provider_name"]))
    # Every row counts here, so choosing a region or setting cannot show a salary already on another row.
    people = {s.id: s for s in db.query(Staff).filter(Staff.id.in_({p["staff_id"] for p in rows}))}
    with_payment(rows, people, amounts_for(db, month))
    providers = [p for p in rows if p["included"] and setting in (None, p["work_setting"])]

    def flagged(check):
        return sorted({p["provider_name"] for p in providers if check in p["checks"]})

    return {
        "month": month, "organization_name": organization.name, "regions": regions, "providers": providers,
        "work_setting": setting, "settings": setting_totals(providers),
        "holidays": public_holidays.between(db, *pay_month_range(month)),
        "missing_bank": flagged(BANK_MISSING), "missing_salary": flagged(SALARY_MISSING), "not_signed": flagged(NOT_SIGNED),
        "totals": {"providers": len({p["staff_id"] for p in providers}), "days": sum(p["days"] for p in providers),
                   "days_signed": sum(p["days_signed"] for p in providers),
                   "hours": str(sum((Decimal(p["hours"]) for p in providers), Decimal(0))),
                   "salary": str(sum((Decimal(p["monthly_salary"]) for p in providers if p["monthly_salary"]), Decimal(0)))},
    }


def month_dates(month):
    start, end = pay_month_range(month)
    return [start + timedelta(days=offset) for offset in range((end - start).days + 1)]


def holiday_text(holidays):
    return "; ".join(f"{row['date']} {row['name_en']}" for row in holidays)


def csv_file(result):
    """One row per provider, with the month's days as columns like the paper timesheet."""
    dates = month_dates(result["month"])
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["Month", "CSO", "Region", "Staff ID", "Provider", "Cadre", "Work setting", "Facility", "Community area", "Salary scale",
                     "Days worked", "Days signed by provider", "Total hours", "Monthly salary (TZS)",
                     "Bank name", "Bank account number", "Bank branch", "Payment check",
                     "Regional Finance sign-off", "Signed on", "Public holidays"]
                    + [f"Day {day.day}" for day in dates])
    for provider in result["providers"]:
        hours = {day["date"]: hours_text(day["hours"]) for day in provider.get("attendance", [])}
        writer.writerow([_cell(value) for value in [
            result["month"], result["organization_name"], provider["region_name"], provider["staff_id"],
            provider["provider_name"], provider["cadre_name"], provider["work_setting"], provider["facility_name"],
            provider["community_area_name"], provider.get("salary_scale"),
            provider["days"], provider["days_signed"], hours_text(provider["hours"]), provider["monthly_salary"],
            provider["bank_name"], provider["bank_account_number"], provider["bank_branch"], "; ".join(provider["checks"]),
            provider["approved_by_name"], provider["approved_at"], holiday_text(result["holidays"]),
        ]] + [hours.get(day.isoformat(), "") for day in dates])
    return ("﻿" + output.getvalue()).encode("utf-8")


def _footer(canvas, document):
    canvas.setFont("Helvetica", 7)
    canvas.drawRightString(document.pagesize[0] - 28, 16, f"Page {document.page}")


def _styles():
    styles = getSampleStyleSheet()
    body = ParagraphStyle("sheet", parent=styles["BodyText"], fontSize=8, leading=10)
    tiny = ParagraphStyle("tiny", parent=body, fontSize=5.5, leading=6.5, alignment=1)
    head = ParagraphStyle("head", parent=tiny, fontName="Helvetica-Bold")
    return styles, body, tiny, head


GRID = TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#8a9a96")),
                   ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e7f2ef")),
                   ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                   ("LEFTPADDING", (0, 0), (-1, -1), 2), ("RIGHTPADDING", (0, 0), (-1, -1), 2),
                   ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)])


# The coloured band that tells the two kinds of timesheet apart, as on the screens (indigo Payroll, teal Services).
KINDS = {
    "PAYROLL": ("#4b4fa6", "PAYROLL TIMESHEET · JEDWALI LA MSHAHARA", "Monthly salary, paid by the CSO to the bank"),
    "SERVICES": ("#0f6b73", "SERVICES TIMESHEET · JEDWALI LA HUDUMA", "Paid per service day by FHI360 Central Finance to the mobile wallet"),
}


def timesheet_page(provider, month, holidays, details, footer, heading=None, kind=None, services=None):
    """One staff member's page: details, the month's attendance by day, and each activity's month total.

    Activities are month totals only: no per-day clinical counts leave the reviewers (a day's count at one facility
    can point to a person)."""
    styles, body, tiny, head = _styles()

    def p(value, style=body):
        return Paragraph(escape(str(value if value not in (None, "") else "—")), style)

    def cell(value):
        return Paragraph(escape(str(value)), tiny) if value else ""

    def bilingual(sw, en):
        return Paragraph(f"<b>{escape(sw)}</b><br/>{escape(en)}", body)

    title = month_title(month)
    dates = month_dates(month)
    holiday_dates = {row["date"] for row in holidays}
    days = {day["date"]: day for day in provider.get("attendance", [])}
    story = []
    if kind in KINDS:
        color, label, who = KINDS[kind]
        band = Table([[Paragraph(f'<font color="white"><b>{escape(label)}</b><br/>{escape(who)}</font>', body)]],
                     colWidths=[786], hAlign="LEFT")
        band.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(color)),
                                  ("LEFTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 5),
                                  ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
        story += [band, Spacer(1, 4)]
    story += [p(heading or provider["cadre_name"], styles["Heading2"]), p(title, styles["Heading3"])]
    rows = [[bilingual(*details[i][0]), p(details[i][1]),
             *((bilingual(*details[i + 1][0]), p(details[i + 1][1])) if i + 1 < len(details) else ("", ""))]
            for i in range(0, len(details), 2)]
    story += [Table(rows, colWidths=[100, 280, 100, 300], hAlign="LEFT"), Spacer(1, 8)]

    def line(sw, en, values, total=""):
        return [bilingual(sw, en)] + values + [Paragraph(escape(total), head)]

    def by_day(read):
        return [cell(read(days[d.isoformat()])) if d.isoformat() in days else "" for d in dates]

    sheet = Table([
        [bilingual("Tarehe", "Date")] + [Paragraph(f"{d.day}<br/>{WEEKDAYS_SW[d.weekday()]}", head) for d in dates]
        + [Paragraph("JUMLA<br/>TOTAL", head)],
        line("Muda wa kuanza", "Start time", by_day(lambda day: day["start"])),
        line("Muda wa kumaliza", "End time", by_day(lambda day: day["end"])),
        line("Masaa", "Hours worked", by_day(lambda day: hours_text(day["hours"])), hours_text(provider["hours"])),
        line("Siku za kazi", "Days worked", [Paragraph('<font name="ZapfDingbats">\u2713</font>', tiny)
                                             if d.isoformat() in days else "" for d in dates], str(provider["days"])),
        *([line("Sikukuu", "Public holiday", [cell("S") if d.isoformat() in holiday_dates else "" for d in dates], str(len(holiday_dates)))]
          if holiday_dates else []),
    ], colWidths=[76] + [(786 - 76 - 34) / len(dates)] * len(dates) + [34], hAlign="LEFT")
    sheet.setStyle(GRID)
    sheet.setStyle(TableStyle([("BACKGROUND", (column, 1), (column, -1), colors.HexColor("#e4e4e4"))
                               for column, day in enumerate(dates, start=1) if day.isoformat() in holiday_dates]))
    story += [sheet, Spacer(1, 8)]
    if services:
        table = Table([[bilingual("Huduma", "Service"), bilingual("Siku za kazi", "Days worked"),
                        bilingual("Siku za kulipwa", "Days paid"), bilingual("Kiasi", "Amount")]]
                      + [[p(row["service"]), p(row["worked"]), p(row["paid"]), p(_number(row["amount"]) if row.get("amount") not in (None, "") else "—")]
                         for row in services],
                      colWidths=[300, 80, 80, 110], hAlign="LEFT", repeatRows=1)
        table.setStyle(GRID)
        story += [p("Huduma zilizotolewa / Services delivered", styles["Heading4"]), table, Spacer(1, 8)]
    indicators = provider.get("indicators") or []
    if indicators:
        activities = Table([[bilingual("Shughuli", "Activity"), bilingual("Jumla ya mwezi", "Month total")]]
                           + [[p(item["label"]), p(_number(item["total"]))] for item in indicators],
                           colWidths=[420, 90], hAlign="LEFT", repeatRows=1)
        activities.setStyle(GRID)
        story += [p("Shughuli zote za mwezi / All activities this month (month totals)", styles["Heading4"]), activities, Spacer(1, 8)]
    if holiday_dates:
        story.append(p("Sikukuu / Public holidays: " + "; ".join(f"{row['date']} {row['name_sw']} / {row['name_en']}" for row in holidays)))
    if not days:
        story.append(p(NO_DAILY_TIMES))
    story += [p(text) for text in footer]
    return story


def _number(value):
    amount = Decimal(str(value))
    return f"{amount:,.0f}" if amount == amount.to_integral_value() else f"{amount:,.2f}"


def pdf_file(result):
    """Every staff member's signed Payroll timesheet, then the payroll payment form as the last pages."""
    from . import payment_forms
    styles, body, tiny, head = _styles()

    def p(value, style=body):
        return Paragraph(escape(str(value if value not in (None, "") else "—")), style)

    title = month_title(result["month"])
    totals = result["totals"]
    story = [p("Salary timesheets", styles["Title"]),
             p(f"{result['organization_name']} | {title}", styles["Heading3"]),
             p(f"Providers: {totals['providers']} | Days signed by providers: {totals['days_signed']} | "
               f"Hours worked: {hours_text(totals['hours'])}"),
             p(f"Total salary: {amount_text(totals['salary'])}", styles["Heading3"]),
             *[p(f"{row['name']}: {row['providers']} {'provider' if row['providers'] == 1 else 'providers'}, {amount_text(row['salary'])}")
               for row in result["settings"]],
             p(NOT_PAYMENT),
             p("Contents: one timesheet page per provider, then the payment form (summary of all staff to pay) as the last pages.")]
    if result["work_setting"]:
        story.insert(2, p(f"{result['work_setting']} providers only"))
    missing = [r["name"] for r in result["regions"] if r["included"] and not r["signed"]]
    if missing:
        story.append(p("Not in this file, because Regional Finance has not signed them: " + ", ".join(missing)))
    for label, key in (("Bank details missing", "missing_bank"), ("Salary amount missing", "missing_salary"),
                       ("Not signed by provider", "not_signed")):
        if result[key]:
            story.append(p(f"{label}: " + ", ".join(result[key])))
    for provider in result["providers"]:
        salary = OTHER_ROW if OTHER_ROW in provider["checks"] else amount_text(provider["monthly_salary"])
        details = [
            (("Mkoa", "Region"), provider["region_name"]), (("Kituo", "Facility"), provider["facility_name"]),
            (("Eneo la jamii", "Community area"), provider["community_area_name"]), (("Mahali pa kazi", "Work setting"), provider["work_setting"]),
            (("Jina", "Name"), provider["provider_name"]), (("Kada", "Cadre"), provider["cadre_name"]),
            (("Ngazi ya mshahara", "Salary scale"), provider["salary_scale"]), (("Namba", "Staff ID"), provider["staff_id"]),
            (("Mshahara", "Monthly salary"), salary),
            (("Benki", "Bank"), " | ".join(str(provider[key] or "Missing") for key in ("bank_name", "bank_account_number", "bank_branch"))),
        ]
        footer = [f"Days signed by provider: {provider['days_signed']}", "Idhini ya RM / RM approval: Completed",
                  f"Regional Finance sign-off: {provider['approved_by_name']}, {provider['approved_at']}", NOT_PAYMENT]
        story += [PageBreak(), *timesheet_page(provider, result["month"], result["holidays"], details, footer, kind="PAYROLL")]
    form = payment_forms.payroll_form(result)
    if form["rows"]:
        story += [PageBreak(), *payment_forms.form_flowables(form, landscape(A4)[0] - 56)]
    output = io.BytesIO()
    SimpleDocTemplate(output, pagesize=landscape(A4), topMargin=28, bottomMargin=28, leftMargin=28, rightMargin=28,
                      title=f"Salary timesheets {result['month']}").build(story, onFirstPage=_footer, onLaterPages=_footer)
    return output.getvalue()
