"""Authenticated aggregate exports for the displayed monthly report only."""
import csv
import io
from html import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def _cell(value):
    text = str(value or "")
    # Excel treats even leading whitespace followed by a formula operator as executable.
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else text


def _rows(result, region_name):
    report, approval = result["report"], result["approval"]
    status = "APPROVED" if approval and not result["stale"] else "DRAFT"
    base = [report["month"], region_name, report["work_type"], status,
            approval["approved_by_name"] if status == "APPROVED" else "",
            approval["approved_at"] if status == "APPROVED" else ""]
    totals = report["totals"]
    yield base + ["REGION", "", "", "", "", totals["days"], totals["hours"], "Providers", totals["providers"]]
    for cadre in report["cadres"]:
        yield base + ["CADRE", cadre["code"], cadre["name"], "", "", cadre["days"], cadre["hours"], "Providers", cadre["provider_count"]]
        for indicator in cadre["indicators"]:
            yield base + ["CADRE_INDICATOR", cadre["code"], cadre["name"], "", "", "", "", indicator["label"], indicator["total"]]
    for provider in report["providers"]:
        yield base + ["PROVIDER", provider["cadre_code"], provider["cadre_name"], provider["provider_name"],
                      provider["facility_name"], provider["days"], provider["hours"], "", ""]
        for indicator in provider["indicators"]:
            yield base + ["PROVIDER_INDICATOR", provider["cadre_code"], provider["cadre_name"], provider["provider_name"],
                          provider["facility_name"], "", "", indicator["label"], indicator["total"]]


def csv_file(result, region_name):
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["Month", "Region", "Work type", "Status", "Approved by", "Approved at",
                     "Row type", "Cadre code", "Cadre", "Provider", "Facility", "Days", "Hours", "Indicator", "Total"])
    writer.writerows([_cell(value) for value in row] for row in _rows(result, region_name))
    return ("\ufeff" + output.getvalue()).encode("utf-8")


def pdf_file(result, region_name):
    output = io.BytesIO()
    document = SimpleDocTemplate(output, pagesize=A4, topMargin=36, bottomMargin=36,
                                 leftMargin=36, rightMargin=36, title="Monthly regional work report")
    styles = getSampleStyleSheet()
    small = styles["BodyText"]
    report, approval = result["report"], result["approval"]
    status = "APPROVED" if approval and not result["stale"] else "DRAFT — not currently approved"
    def p(value, style=small):
        return Paragraph(escape(str(value)), style)
    contents = [p("Regional monthly work report", styles["Title"]),
                p(f"{region_name} | {report['month']} | {report['work_type']}"),
                p(f"Status: {status}"),
                p(f"Regional Finance approval: {approval['approved_by_name']} at {approval['approved_at']}"
                  if status == "APPROVED" else "No current Regional Finance sign-off"),
                Spacer(1, 14),
                p(f"{report['totals']['providers']} providers | {report['totals']['days']} days | "
                  f"{report['totals']['hours']} hours", styles["Heading2"]), Spacer(1, 10)]
    for cadre in report["cadres"]:
        contents.extend([p(cadre["name"], styles["Heading2"]),
                         p(f"{cadre['provider_count']} providers | {cadre['days']} days | {cadre['hours']} hours")])
        for indicator in cadre["indicators"]:
            contents.append(p(f"{indicator['label']}: {indicator['total']}"))
        providers = [provider for provider in report["providers"] if provider["cadre_code"] == cadre["code"]]
        table = Table([[p("Provider"), p("Facility"), p("Days"), p("Hours")]] +
            [[p(provider["provider_name"]), p(provider["facility_name"]), p(provider["days"]), p(provider["hours"])]
             for provider in providers], colWidths=[155, 155, 48, 68], repeatRows=1, hAlign="LEFT")
        table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e7f2ef")),
                                   ("VALIGN", (0, 0), (-1, -1), "TOP"),
                                   ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
        contents.extend([Spacer(1, 5), table])
        for provider in providers:
            if provider["indicators"]:
                contents.append(p(f"{provider['provider_name']}: " +
                     ", ".join(f"{i['label']} {i['total']}" for i in provider["indicators"])))
        contents.append(Spacer(1, 14))
    document.build(contents)
    return output.getvalue()
