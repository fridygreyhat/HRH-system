"""Scoped Services payment documentation; monetary values use frozen claim lines."""
import csv
import io
from collections import defaultdict
from decimal import Decimal
from html import escape

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import aliased
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from ..core.period_dates import pay_month_range
from ..models import PaymentClaim, Staff, StaffAssignment, Facility, Region, WorkLog, WorkLogEntry
from .service_targets import monthly_minimums
from .v22_scope import record_condition
from .provider_payment_details import details
from .monthly_report_exports import _cell


HEADERS = ["Region", "Facility", "Provider name", "Services name", "Days worked",
           "Payable days", "Service amount", "Currency", "Mobile number", "Claim ID", "Payment status",
           "Minimum days", "Days short"]


def rows(db, current, month, region_id=None):
    try:
        year, number = map(int, month.split("-"))
        if not 2000 <= year <= 2100:
            raise ValueError()
        start, end = pay_month_range(month)
    except ValueError:
        raise HTTPException(422, "Select a valid month between 2000 and 2100.")
    # Aliases prevent outer joins from accidentally correlating scope subqueries.
    assignment, facility, region = aliased(StaffAssignment), aliased(Facility), aliased(Region)
    cadre = select(WorkLog.cadre_id).where(WorkLog.id == PaymentClaim.work_log_id).scalar_subquery()
    query = (db.query(PaymentClaim, Staff, facility.name, region.name, region.id)
             .join(Staff, Staff.id == PaymentClaim.staff_id)
             .join(assignment, assignment.id == PaymentClaim.assignment_id)
             .outerjoin(facility, facility.id == assignment.facility_id)
             .join(region, region.id == assignment.region_id)
             .filter(PaymentClaim.work_type == "SERVICES", PaymentClaim.route_code.in_(["A", "B"]),
                     PaymentClaim.status != "CANCELLED",
                     record_condition(current, PaymentClaim.assignment_id, cadre),
                     PaymentClaim.work_log_id.in_(select(WorkLogEntry.work_log_id).where(
                         WorkLogEntry.entry_date.between(start, end)))))
    if region_id:
        from .v22_scope import regions_for
        if not current.unrestricted and region_id not in regions_for(current):
            raise HTTPException(403, "This region is outside your finance scope.")
        query = query.filter(assignment.region_id == region_id)
    claims = query.order_by(region.name, facility.name, Staff.first_name, Staff.last_name, Staff.id, PaymentClaim.id).all()
    # One additional query, not one per provider. No 500-row list-screen limit.
    logs = [claim.work_log_id for claim, *_ in claims]
    entries = defaultdict(list)
    for entry in db.query(WorkLogEntry).filter(
            WorkLogEntry.work_log_id.in_(logs), WorkLogEntry.entry_date.between(start, end)):
        entries[entry.work_log_id].append(entry)
    built, done = [], defaultdict(set)
    for claim, staff, facility_name, region_name, region_id in claims:
        groups = {}
        def service(key, name):
            return groups.setdefault((key, name), {"worked": set(), "paid": set(), "amount": Decimal(0)})
        for entry in entries[claim.work_log_id]:
            activity = entry.activity_snapshot or {}
            service(activity.get("key", entry.activity_key), activity.get("label_en", entry.activity_key))["worked"].add(str(entry.entry_date))
            for extra in activity.get("additional_services", []):
                item = extra["activity"]
                service(item.get("key"), item.get("label_en", item.get("key")))["worked"].add(str(entry.entry_date))
        for line in (claim.calculation_snapshot or {}).get("lines", []):
            if str(start) <= line.get("date", "") <= str(end):
                group = service(line.get("activity_key"), line["activity"])
                group["worked"].add(line["date"])
                group["paid"].add(line["date"])
                group["amount"] += Decimal(str(line["amount"]))
        for (_, name), group in groups.items():
            done[(staff.id, name)] |= group["worked"]
        built.append((claim, staff, facility_name, region_name, region_id, groups))
    minimums, output, listed = monthly_minimums(db, end), [], set()
    for claim, staff, facility_name, region_name, region_id, groups in built:
        mobile = details(staff)["mobile_money_number"] or staff.verified_phone
        targets = minimums.get((staff.cadre_id, region_id), {})

        def row(name, worked, paid, amount):
            minimum = targets.get(name)
            short = max(minimum - len(done[(staff.id, name)]), 0) if minimum else ""
            return [region_name, facility_name or "Community / no facility", staff.legal_name, name, worked, paid, str(amount),
                    claim.currency, mobile, claim.id, claim.payment_status, minimum or "", short]

        for (_, name), group in sorted(groups.items(), key=lambda item: str(item[0])):
            output.append(row(name, len(group["worked"]), len(group["paid"]), group["amount"]))
        if staff.id not in listed:  # a service never worked has no claim line, so its shortfall needs a row of its own
            listed.add(staff.id)
            output.extend(row(name, 0, 0, Decimal(0)) for name in sorted(targets) if (staff.id, name) not in done)
    if not output:
        raise HTTPException(404, "No routed Services are available for this month and finance scope.")
    return output


def totals(rows):
    result = defaultdict(Decimal)
    for row in rows:
        result[row[7]] += Decimal(row[6])
    return dict(result)


def csv_file(rows):
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(HEADERS)
    writer.writerows([_cell(value) for value in row] for row in rows)
    for currency, total in sorted(totals(rows).items()):
        writer.writerow(["TOTAL ALL SERVICES", "", "", "", "", "", str(total), currency, "", "", "", "", ""])
    return ("\ufeff" + output.getvalue()).encode("utf-8")


def pdf_file(rows, month):
    output = io.BytesIO()
    styles = getSampleStyleSheet()
    styles["BodyText"].fontSize = 7
    styles["BodyText"].leading = 9
    def p(value):
        return Paragraph(escape(str(value)), styles["BodyText"])
    content = [Paragraph(f"Services payment report — {escape(month)}", styles["Title"]),
               p("Days worked include all recorded services. Payable days and amounts follow the frozen claim: "
                 "only the highest fixed daily service is paid. Approved or routed does not mean paid. "
                 "Mobile number is the configured wallet number, otherwise the registered contact. "
                 "Days short shows how far a provider is below a service's monthly minimum. It does not change the amount paid."),
               Spacer(1, 10)]
    table = Table([[p(h) for h in HEADERS]] + [[p(v) for v in row] for row in rows],
                  colWidths=[62, 68, 82, 112, 38, 38, 62, 33, 78, 38, 55, 42, 34], repeatRows=1)
    table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e7f2ef")),
                               ("VALIGN", (0, 0), (-1, -1), "TOP"),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    content.append(table)
    content += [Spacer(1, 10), p("Total all Services: " + "; ".join(
        f"{currency} {amount:,.2f}" for currency, amount in sorted(totals(rows).items())))]
    SimpleDocTemplate(output, pagesize=landscape(A4), leftMargin=20, rightMargin=20,
                      topMargin=24, bottomMargin=24).build(content)
    return output.getvalue()
