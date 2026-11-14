"""Finance downloads: Payroll and Services kept separate, for a region, one facility or one person.

Each finance role gets its own part of the money flow:
- Regional Finance: both work types, the RM-approved work of its regions (before and after sending).
- FHI360 Central Finance: Services approved for payment (the claims Regional Finance sent to it).
- CSO Finance: the Payroll Regional Finance signed and sent to it.
Activities are month totals only: per-day clinical counts stay with the reviewers.
"""
import csv
import io
from collections import defaultdict
from decimal import Decimal
from html import escape

from fastapi import HTTPException
from openpyxl import Workbook
from openpyxl.styles import Font
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from ..core.period_dates import pay_month_range
from ..core.roles import CSO_FINANCE, FHI360_FINANCE, REGIONAL_FINANCE
from ..models import Facility, PaymentClaim, Region, Staff, WorkLog, WorkLogEntry
from . import monthly_report_approval as reports
from . import payment_forms, public_holidays
from .finance_reports import authorized, monthly_summary
from .provider_payment_details import details
from .salary_amounts import amounts_for
from .salary_timesheets import (MAX_PDF_PROVIDERS, NOT_PAYMENT, OTHER_ROW, _footer, month_title, timesheet_page,
                                with_payment)
from .v22_scope import regions_for

SERVICES_STATE = {"PENDING_FINANCE_REVIEW": "Waiting for Regional Finance review", "FINANCE_REVIEWED": "Ready to send",
                  "BUDGET_HOLD": "On hold", "ROUTED_FHI360": "Sent to Central Finance", "PAID": "Paid"}


def regional(current):
    return current.unrestricted or current.has_any(REGIONAL_FINANCE)


def work_types(current):
    """Which work this person's downloads cover. Payroll is the CSO's; Services are FHI360's."""
    if regional(current):
        return ["PAYROLL", "SERVICES"]
    return [kind for kind, role in (("PAYROLL", CSO_FINANCE), ("SERVICES", FHI360_FINANCE)) if current.has_any(role)]


def regions(db, current):
    allowed = reports.cso_regions(db, current) if reports.cso_only(current) else regions_for(current)
    query = db.query(Region)
    if not current.unrestricted:
        query = query.filter(Region.id.in_(allowed))
    return [{"id": r.id, "name": r.name} for r in query.order_by(Region.name)]


def facilities(db, current, region_id):
    from ..models import District, Ward
    if region_id not in {r["id"] for r in regions(db, current)}:
        raise HTTPException(403, "This region is outside your finance scope.")
    rows = (db.query(Facility.id, Facility.name).join(Ward, Ward.id == Facility.ward_id)
            .join(District, District.id == Ward.district_id).filter(District.region_id == region_id)
            .order_by(Facility.name))
    return [{"id": fid, "name": name} for fid, name in rows]


def _check(db, current, work_type, region_id):
    if work_type not in work_types(current):
        raise HTTPException(403, reports.SERVICES_NOT_FOR_CSO if work_type == "SERVICES"
                            else "Payroll goes to the CSO; FHI360 Central Finance receives Services.")
    if region_id and region_id not in {r["id"] for r in regions(db, current)}:
        raise HTTPException(403, "This region is outside your finance scope.")


def cadres(db, current):
    """The cadres this person's downloads can be narrowed to."""
    from ..models import Cadre
    query = db.query(Cadre).filter(Cadre.code.in_(["CHW", "HCP", "DATA_CLERK"]))
    if not current.unrestricted and current.review_cadres:
        query = query.filter(Cadre.id.in_(current.review_cadres))
    return [{"id": c.id, "name": c.name} for c in query.order_by(Cadre.name)]


def pack(db, current, work_type, month, region_id=None, facility_id=None, staff_id=None, cadre_id=None):
    """Everyone in the selection, with attendance, activity month totals and what they are to be paid."""
    reports.check_month(month)
    _check(db, current, work_type, region_id)
    facility_name = db.get(Facility, facility_id).name if facility_id and db.get(Facility, facility_id) else None
    if facility_id and not facility_name:
        raise HTTPException(404, "Facility not found.")
    from ..models import Cadre
    cadre_name = db.get(Cadre, cadre_id).name if cadre_id and db.get(Cadre, cadre_id) else None
    if work_type == "PAYROLL":
        people = _regional_payroll(db, current, month, region_id, facility_id, staff_id, cadre_id) if regional(current) \
            else _cso_payroll(db, current, month, region_id, facility_name, staff_id)
    else:
        people = _regional_services(db, current, month, region_id, facility_id, staff_id, cadre_id) if regional(current) \
            else _central_services(db, current, month, region_id, facility_name, staff_id)
    if cadre_name:  # the CSO's and Central Finance's lists come from signed or approved records: filter by name
        people = [p for p in people if p["cadre"] == cadre_name]
    people.sort(key=lambda p: (p["region"], p["facility"] or "", p["name"]))
    region = db.get(Region, region_id).name if region_id else None
    totals = defaultdict(Decimal)
    for person in people:
        if person["amount"] is not None:
            totals[person["currency"]] += Decimal(person["amount"])
    return {"work_type": work_type, "month": month, "region": region, "facility": facility_name, "cadre": cadre_name, "people": people,
            "totals": {currency: str(total) for currency, total in totals.items()}}


def _person(provider, **extra):
    return {"staff_id": provider["staff_id"], "name": provider["provider_name"], "cadre": provider["cadre_name"],
            "region": provider["region_name"], "facility": provider.get("facility_name") or "",
            "community_area": provider.get("community_area_name"), "days": provider["days"], "hours": provider["hours"],
            "attendance": provider.get("attendance", []), "indicators": provider.get("indicators", []),
            "salary_scale": provider.get("salary_scale"), "currency": "TZS", "claim_id": None, "mobile": "",
            "bank_name": "", "bank_account_number": "", "bank_branch": "", "checks": [], "breakdown": [], **extra}


def _regional_payroll(db, current, month, region_id, facility_id, staff_id, cadre_id=None):
    providers = monthly_summary(db, current, month, region_id, "PAYROLL", daily=True, facility_id=facility_id, staff_id=staff_id, cadre_id=cadre_id)["providers"]
    staff = {s.id: s for s in db.query(Staff).filter(Staff.id.in_({p["staff_id"] for p in providers} or {-1}))}
    with_payment(providers, staff, amounts_for(db, month))
    signed = {}  # region name -> staff on its latest signed Payroll report
    for region in db.query(Region).filter(Region.name.in_({p["region_name"] for p in providers} or {""})):
        latest = reports.latest(db, month, region.id, "PAYROLL")
        signed[region.name] = {p["staff_id"] for p in latest.snapshot["regional"]["providers"]} if latest else set()
    return [_person(p, amount=None if OTHER_ROW in p["checks"] else p["monthly_salary"],
                    state="Signed and sent to CSO" if p["staff_id"] in signed.get(p["region_name"], set()) else "Not sent to CSO",
                    bank_name=p["bank_name"] or "", bank_account_number=p["bank_account_number"] or "",
                    bank_branch=p["bank_branch"] or "", checks=p["checks"]) for p in providers]


def _cso_payroll(db, current, month, region_id, facility_name, staff_id):
    from ..models import Organization
    from .salary_timesheets import signed
    org_ids = current.scope_values("organization_id")
    org = db.query(Organization).filter(Organization.id.in_(org_ids or [-1]), Organization.type == "CSO").order_by(Organization.id).first()
    if not org:
        return []
    result = signed(db, current, org, month, region_id)
    providers = [p for p in result["providers"] if (not facility_name or p["facility_name"] == facility_name)
                 and (not staff_id or p["staff_id"] == staff_id)]
    return [_person(p, amount=None if OTHER_ROW in p["checks"] else p["monthly_salary"], state="Signed by Regional Finance",
                    days=p["days"], bank_name=p["bank_name"] or "", bank_account_number=p["bank_account_number"] or "",
                    bank_branch=p["bank_branch"] or "", checks=p["checks"]) for p in providers]


def _regional_services(db, current, month, region_id, facility_id, staff_id, cadre_id=None):
    providers = monthly_summary(db, current, month, region_id, "SERVICES", daily=True, facility_id=facility_id, staff_id=staff_id, cadre_id=cadre_id)["providers"]
    start, end = pay_month_range(month)
    logs = (db.query(WorkLog).filter(WorkLog.work_type == "SERVICES", *authorized(current),
                                     WorkLog.staff_id.in_({p["staff_id"] for p in providers} or {-1}),
                                     WorkLog.id.in_(db.query(WorkLogEntry.work_log_id).filter(WorkLogEntry.entry_date.between(start, end))))
            .all())
    money = defaultdict(lambda: {"amount": None, "states": set(), "claims": []})
    claims = {c.work_log_id: c for c in db.query(PaymentClaim).filter(PaymentClaim.work_log_id.in_([l.id for l in logs] or [-1]),
                                                                      PaymentClaim.status != "CANCELLED")}
    for log in logs:
        item = money[log.staff_id]
        item["states"].add(SERVICES_STATE.get(log.status, log.status.replace("_", " ").title()))
        claim = claims.get(log.id)
        amount = claim.amount if claim else (log.finance_snapshot or {}).get("total")
        if amount is not None:
            item["amount"] = (item["amount"] or Decimal(0)) + Decimal(str(amount))
        if claim:
            item["claims"].append(claim.id)
    breakdown = _services_breakdown(db, logs, claims, start, end)
    staff = {s.id: s for s in db.query(Staff).filter(Staff.id.in_({p["staff_id"] for p in providers} or {-1}))}
    out = []
    for p in providers:
        item = money[p["staff_id"]]
        person = staff.get(p["staff_id"])
        out.append(_person(p, amount=str(item["amount"]) if item["amount"] is not None else None,
                           state=", ".join(sorted(item["states"])) or "Waiting for Regional Finance review",
                           claim_id=item["claims"][0] if item["claims"] else None,
                           breakdown=breakdown.get(p["staff_id"], []),
                           mobile=(details(person)["mobile_money_number"] or person.verified_phone) if person else ""))
    return out


def _services_breakdown(db, logs, claims, start, end):
    """Per person and service: days worked, days paid and amount, from the entries and the claim (or reviewed amount)."""
    from .finance_gate import preview
    result = defaultdict(dict)
    entries = defaultdict(list)
    for entry in db.query(WorkLogEntry).filter(WorkLogEntry.work_log_id.in_([log.id for log in logs] or [-1]),
                                               WorkLogEntry.entry_date.between(start, end)):
        entries[entry.work_log_id].append(entry)

    def service(staff_id, name):
        return result[staff_id].setdefault(name, {"service": name, "worked": set(), "paid": set(), "amount": Decimal(0)})

    for log in logs:
        for entry in entries[log.id]:
            snapshot = entry.activity_snapshot or {}
            service(log.staff_id, snapshot.get("label_en") or entry.activity_key or "Service")["worked"].add(entry.entry_date)
            for extra in snapshot.get("additional_services", []):
                service(log.staff_id, (extra.get("activity") or {}).get("label_en") or "Service")["worked"].add(entry.entry_date)
        claim = claims.get(log.id)
        try:
            lines = (claim.calculation_snapshot or {}).get("lines") if claim else (log.finance_snapshot or {}).get("lines") or preview(db, log).get("lines")
        except (KeyError, TypeError, ValueError, AttributeError):
            lines = []
        for line in lines or []:
            if line.get("date") and str(start) <= line["date"] <= str(end):
                item = service(log.staff_id, line.get("activity") or "Service")
                item["paid"].add(line["date"])
                item["amount"] += Decimal(str(line.get("amount") or 0))
    return {sid: [{"service": v["service"], "worked": len(v["worked"]), "paid": len(v["paid"]), "amount": str(v["amount"])}
                  for v in sorted(items.values(), key=lambda v: v["service"])] for sid, items in result.items()}


def _central_services(db, current, month, region_id, facility_name, staff_id):
    try:
        form = payment_forms.services_form(db, current, month, region_id, include_prf=True)
    except HTTPException as error:
        if error.status_code == 404:
            return []
        raise
    staff_of = dict(db.query(PaymentClaim.id, PaymentClaim.staff_id).filter(PaymentClaim.id.in_([r["claim_id"] for r in form["rows"]] or [-1])))
    providers = defaultdict(list)
    for item in monthly_summary(db, current, month, region_id, "SERVICES", daily=True)["providers"]:
        providers[item["staff_id"]].append(item)
    out = []
    for row in form["rows"]:
        sid = staff_of.get(row["claim_id"])
        if (facility_name and row["facility"] != facility_name) or (staff_id and sid != staff_id):
            continue
        found = [item for item in providers.get(sid, []) if item["region_name"] == row["region"]]
        base = payment_forms._merged(found) if found else {"staff_id": sid, "provider_name": row["name"], "cadre_name": "",
                                                           "region_name": row["region"], "facility_name": row["facility"],
                                                           "days": row["days"], "hours": "0", "attendance": [], "indicators": []}
        out.append(_person(base, name=row["name"], region=row["region"], facility=row["facility"], days=row["days"],
                           amount=row["total"], currency=row["currency"], claim_id=row["claim_id"], mobile=row["mobile"],
                           state="Approved by Central Finance", breakdown=row.get("breakdown", []), cadre=row.get("cadre") or base.get("cadre_name", "")))
    return out


# ---- Files ---------------------------------------------------------------------------------------------------------

def _title(data):
    where = " - ".join(filter(None, (data["region"], data["facility"], data.get("cadre"))))
    kind = "Monthly salary payments" if data["work_type"] == "PAYROLL" else "Services payments"
    return f"{kind} - {payment_forms.month_text(data['month'])}" + (f" - {where}" if where else "")


def form(data):
    """The payment summary (EpiC / FHI360 form) for the selection."""
    payroll = data["work_type"] == "PAYROLL"
    rows = []
    for i, p in enumerate(data["people"], start=1):
        row = {"sn": i, "name": p["name"], "cadre": p["cadre"], "region": p["region"],
               "facility": p["facility"] or p["community_area"] or "", "days": p["days"],
               "subtotal": p["amount"], "total": p["amount"], "currency": p["currency"], "checks": p["checks"]}
        if payroll:
            row.update(salary=p["amount"], bank_name=p["bank_name"], bank_account_number=p["bank_account_number"])
        else:
            row.update(mobile=p["mobile"], claim_id=p["claim_id"], services="")
        rows.append(row)
    return {"kind": data["work_type"], "month": data["month"], "activity": _title(data),
            "venue": payment_forms.joined(p["region"] for p in data["people"]),
            "columns": payment_forms.PAYROLL_COLUMNS if payroll else payment_forms.SERVICES_COLUMNS,
            "rows": rows, "totals": data["totals"]}


def timesheets_pdf(db, data):
    if len(data["people"]) > MAX_PDF_PROVIDERS:
        raise HTTPException(422, f"This PDF would have {len(data['people']):,} timesheet pages. Choose a facility, or a smaller "
                                 f"region, to keep it under {MAX_PDF_PROVIDERS:,}. The payment summary and import file include everyone.")
    holidays = public_holidays.between(db, *pay_month_range(data["month"]))
    styles = getSampleStyleSheet()
    payroll = data["work_type"] == "PAYROLL"
    story = [Paragraph("Payroll timesheets (salary)" if payroll else "Services timesheets", styles["Title"]),
             Paragraph(escape(_title(data)), styles["Heading3"]),
             Paragraph(escape(f"Providers: {len(data['people'])} | Total: {payment_forms.total_text(form(data))}"), styles["Heading3"]),
             Paragraph("One timesheet page per provider (attendance and the month's activity totals), then the payment "
                       "summary as the last pages. " + NOT_PAYMENT, styles["BodyText"])]
    for p in data["people"]:
        amount = f"{p['currency']} {payment_forms.money(p['amount'])}" if p["amount"] is not None else "Not yet set"
        info = [(("Mkoa", "Region"), p["region"]), (("Kituo", "Facility"), p["facility"] or p["community_area"]),
                (("Jina", "Name"), p["name"]), (("Kada", "Cadre"), p["cadre"]),
                (("Siku", "Days"), p["days"]), (("Hali", "Status"), p["state"])]
        info += ([(("Mshahara", "Monthly salary"), amount), (("Benki", "Bank"),
                   " | ".join(x or "Missing" for x in (p["bank_name"], p["bank_account_number"], p["bank_branch"])))]
                 if payroll else [(("Kiasi", "Amount"), amount), (("Simu ya malipo", "Mobile wallet"), p["mobile"] or "Missing")])
        provider = {"cadre_name": p["cadre"], "attendance": p["attendance"], "hours": p["hours"], "days": p["days"],
                    "indicators": p["indicators"]}
        story += [PageBreak(), *timesheet_page(provider, data["month"], holidays, info, [NOT_PAYMENT], heading=p["cadre"] or None,
                                               kind=data["work_type"], services=None if payroll else p["breakdown"])]
    if data["people"]:
        story += [PageBreak(), *payment_forms.form_flowables(form(data), landscape(A4)[0] - 56)]
    output = io.BytesIO()
    SimpleDocTemplate(output, pagesize=landscape(A4), topMargin=28, bottomMargin=28, leftMargin=28, rightMargin=28,
                      title=f"Timesheets {data['month']}").build(story, onFirstPage=_footer, onLaterPages=_footer)
    return output.getvalue()


GROUPS = {"person": "Person", "facility": "Facility", "region": "Region", "cadre": "Cadre", "all": "All providers"}
ACTIVITY_COLUMNS = ["Month", "Work type", "Totals by", "Region", "Facility", "Cadre", "Name", "Staff ID", "Providers",
                    "Days", "Hours", "Activity", "Month total"]


def activity_groups(data, group_by="person"):
    """Activity month totals added up per person, facility, region, cadre or for everyone in the selection."""
    if group_by not in GROUPS:
        raise HTTPException(422, "Choose totals by person, facility, region, cadre or all.")
    groups = {}
    for p in data["people"]:
        facility = p["facility"] or p["community_area"] or ""
        key, dims = {
            "person": ((p["staff_id"], p["region"], facility), {"region": p["region"], "facility": facility, "cadre": p["cadre"], "name": p["name"], "staff_id": p["staff_id"]}),
            "facility": ((p["region"], facility), {"region": p["region"], "facility": facility}),
            "region": ((p["region"],), {"region": p["region"]}),
            "cadre": ((p["cadre"],), {"cadre": p["cadre"]}),
            "all": ((), {}),
        }[group_by]
        group = groups.setdefault(key, {"region": "", "facility": "", "cadre": "", "name": "", "staff_id": None, **dims,
                                        "staff": set(), "days": 0, "hours": Decimal(0), "activities": {}})
        group["staff"].add(p["staff_id"])
        group["days"] += p["days"]
        group["hours"] += Decimal(str(p["hours"]))
        for item in p["indicators"]:
            activity = group["activities"].setdefault(item["key"], {"label": item["label"], "total": Decimal(0)})
            activity["total"] += Decimal(str(item["total"]))
    out = []
    for group in groups.values():
        out.append({**{k: group[k] for k in ("region", "facility", "cadre", "name", "staff_id", "days")},
                    "providers": len(group["staff"]), "hours": group["hours"],
                    "activities": sorted(group["activities"].values(), key=lambda a: a["label"])})
    return sorted(out, key=lambda g: (g["region"], g["facility"], g["cadre"], g["name"]))


def _group_name(group, group_by):
    return {"person": group["name"], "facility": f"{group['facility']} ({group['region']})", "region": group["region"],
            "cadre": group["cadre"], "all": "All providers"}[group_by]


def activities_xlsx(data, group_by="person"):
    """One row per group and activity, so the totals filter, sort and import easily."""
    book = Workbook()
    sheet = book.active
    sheet.title = "Activities"
    sheet.append(ACTIVITY_COLUMNS)
    for cell in sheet[1]:
        cell.font = Font(bold=True)
    for group in activity_groups(data, group_by):
        base = [data["month"], data["work_type"].title(), GROUPS[group_by], group["region"], group["facility"], group["cadre"],
                group["name"], group["staff_id"], group["providers"], group["days"], float(group["hours"])]
        for activity in group["activities"] or [{"label": "", "total": None}]:
            _append(sheet, base + [activity["label"], float(activity["total"]) if activity["total"] is not None else None])
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = f"A1:M{sheet.max_row}"
    for letter, width in zip("ABCDEFGHIJKLM", (9, 10, 12, 13, 26, 22, 26, 9, 10, 7, 9, 42, 12)):
        sheet.column_dimensions[letter].width = width
    output = io.BytesIO()
    book.save(output)
    return output.getvalue()


def activities_pdf(data, group_by="person"):
    styles = getSampleStyleSheet()
    body = ParagraphStyle("act", parent=styles["BodyText"], fontSize=7.5, leading=9)
    grid = TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#8a9a96")),
                       ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e7f2ef")), ("VALIGN", (0, 0), (-1, -1), "TOP")])
    kind = "Payroll" if data["work_type"] == "PAYROLL" else "Services"
    story = [Paragraph(f"{kind} activity totals by {GROUPS[group_by].lower()}", styles["Title"]),
             Paragraph(escape(_title(data)), styles["Heading3"]),
             Paragraph("Month totals added up for each group. Per-day clinical counts stay with the reviewers.", body), Spacer(1, 8)]
    rows = [[Paragraph(f"<b>{escape(h)}</b>", body) for h in (GROUPS[group_by], "Providers", "Days", "Hours", "Activities (month totals)")]]
    for group in activity_groups(data, group_by):
        acts = "<br/>".join(f"{escape(a['label'])}: <b>{payment_forms.money(a['total'])}</b>" for a in group["activities"]) or "—"
        rows.append([Paragraph(escape(str(v)), body) for v in (_group_name(group, group_by), group["providers"], group["days"],
                                                                 payment_forms.money(group["hours"]))] + [Paragraph(acts, body)])
    table = Table(rows, colWidths=[180, 55, 45, 55, 450], repeatRows=1)
    table.setStyle(grid)
    story.append(table)
    output = io.BytesIO()
    SimpleDocTemplate(output, pagesize=landscape(A4), topMargin=28, bottomMargin=28, leftMargin=28, rightMargin=28,
                      title=f"Activity totals {data['month']}").build(story, onFirstPage=_footer, onLaterPages=_footer)
    return output.getvalue()


# The import file: one header row, one row per person, plain values and IDs to match on. No logos, merged cells or totals.
IMPORT_COLUMNS = {
    "PAYROLL": ["Staff ID", "Name", "Cadre", "Region", "Facility", "Month", "Days filled", "Monthly salary", "Total amount",
                "Currency", "Bank name", "Account number", "Bank branch", "Status"],
    "SERVICES": ["Staff ID", "Claim ID", "Name", "Cadre", "Region", "Facility", "Month", "Days", "Total amount", "Currency",
                 "Mobile number", "Status"],
}
TEXT_COLUMNS = {"Account number", "Mobile number", "Name", "Facility", "Bank name", "Bank branch"}


def import_rows(data):
    for p in data["people"]:
        amount = float(Decimal(p["amount"])) if p["amount"] is not None else None
        facility = p["facility"] or p["community_area"] or ""
        if data["work_type"] == "PAYROLL":
            yield [p["staff_id"], p["name"], p["cadre"], p["region"], facility, data["month"], p["days"], amount, amount,
                   p["currency"], p["bank_name"], p["bank_account_number"], p["bank_branch"], p["state"]]
        else:
            yield [p["staff_id"], p["claim_id"], p["name"], p["cadre"], p["region"], facility, data["month"], p["days"], amount,
                   p["currency"], p["mobile"], p["state"]]


def import_xlsx(data):
    columns = IMPORT_COLUMNS[data["work_type"]]
    book = Workbook()
    sheet = book.active
    sheet.title = "Import"
    sheet.append(columns)
    for cell in sheet[1]:
        cell.font = Font(bold=True)
    for values in import_rows(data):
        _append(sheet, values)
        for index, title in enumerate(columns, start=1):
            if title in TEXT_COLUMNS:  # account and phone numbers keep their leading zeros
                cell = sheet.cell(sheet.max_row, index)
                cell.number_format, cell.data_type = "@", "s"
                cell.value = "" if cell.value is None else str(cell.value)
    for index, title in enumerate(columns, start=1):
        sheet.column_dimensions[sheet.cell(1, index).column_letter].width = max(10, min(len(title) + 6, 28))
    output = io.BytesIO()
    book.save(output)
    return output.getvalue()


def import_csv(data):
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(IMPORT_COLUMNS[data["work_type"]])
    for values in import_rows(data):
        writer.writerow(["" if v is None else _csv_text(v) for v in values])
    return ("﻿" + output.getvalue()).encode("utf-8")


def _append(sheet, values):
    """A name or number typed as =... stays text in Excel, never a formula."""
    sheet.append(values)
    for cell in sheet[sheet.max_row]:
        if isinstance(cell.value, str) and cell.value.startswith("="):
            cell.data_type = "s"


def _csv_text(value):
    return ("'" + value) if isinstance(value, str) and value[:1] in ("=", "@") else value
