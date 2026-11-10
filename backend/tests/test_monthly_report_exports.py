"""Report downloads show hours and counts the way people read them, never as stored decimals."""
import csv
import io

from backend.services.monthly_report_exports import count_text, csv_file, hours_text, pdf_file


def report():
    indicator = {"key": "clients", "label": "Clients served", "total": "10.00"}
    return {"approval": None, "stale": False, "report": {
        "month": "2026-10", "work_type": "PAYROLL",
        "totals": {"providers": 1, "days": 5, "hours": "41.666665", "logs": 1},
        "cadres": [{"code": "CHW", "name": "Community Health Worker", "provider_count": 1, "days": 5, "hours": "41.666665",
                    "indicators": [indicator]}],
        "providers": [{"staff_id": 1, "provider_name": "Hassan Mgenza", "cadre_code": "CHW", "cadre_name": "Community Health Worker",
                       "facility_name": "Kihesa Sokoni", "region_name": "Iringa", "days": 5, "hours": "40.000000",
                       "indicators": [indicator]}]}}


def test_hours_and_counts_read_as_people_write_them():
    assert hours_text("40.000000") == "40"
    assert hours_text("41.666665") == "41 h 40 min"  # five days of 08:00-16:20
    assert hours_text("7.5") == "7 h 30 min"
    assert count_text("10.00") == "10" and count_text("2.50") == "2.5" and count_text("0") == "0"


def test_monthly_report_csv_has_no_decimal_hours_or_counts():
    rows = list(csv.reader(io.StringIO(csv_file(report(), "Iringa").decode("utf-8-sig"))))
    header, body = rows[0], rows[1:]
    hours = [row[header.index("Hours")] for row in body if row[header.index("Hours")]]
    totals = [row[header.index("Total")] for row in body if row[header.index("Row type")].endswith("INDICATOR")]
    assert hours == ["41 h 40 min", "41 h 40 min", "40"]
    assert totals == ["10", "10"]


def test_monthly_report_pdf_builds_with_readable_hours():
    assert pdf_file(report(), "Iringa").startswith(b"%PDF")


def test_hour_limit_messages_read_in_hours_and_minutes():
    from datetime import date
    from decimal import Decimal
    from backend.services.work_hours import day_hours_violation
    limits = {"daily_hours": Decimal("8.0"), "weekly_hours": Decimal("45.0"),
              "saturday_min_hours": Decimal("4.0"), "saturday_max_hours": Decimal("6.0")}
    weekday = day_hours_violation(date(2026, 10, 1), Decimal("8.333333"), limits)["message"]
    saturday = day_hours_violation(date(2026, 10, 3), Decimal("7.5"), limits)["message"]
    assert weekday == "Weekday hours may not exceed 8 per day (this date would total 8 h 20 min)."
    assert saturday == "Saturday weekend clinics require 4–6 total hours (this date would total 7 h 30 min)."
