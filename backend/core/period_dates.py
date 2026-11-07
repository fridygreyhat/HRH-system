"""Bounded reporting periods, and the pay month every report, budget and salary file shares."""
from datetime import date

MIN_PERIOD_YEAR = 2000
MAX_PERIOD_YEAR = 2100
MAX_PERIOD_DAYS = 366
PAY_MONTH_END_DAY = 25  # a pay month runs from the 26th to the 25th; frontend/src/format.ts matches this


def pay_month_of(day: date) -> str:
    """The pay month a date belongs to, named after the month it ends in: 26 Oct to 25 Nov is 2026-11."""
    if day.day <= PAY_MONTH_END_DAY:
        return f"{day.year}-{day.month:02d}"
    return f"{day.year + 1}-01" if day.month == 12 else f"{day.year}-{day.month + 1:02d}"


def pay_month_range(month: str) -> tuple[date, date]:
    year, number = map(int, month.split("-"))
    end = date(year, number, PAY_MONTH_END_DAY)
    start = date(year - 1, 12, PAY_MONTH_END_DAY + 1) if number == 1 else date(year, number - 1, PAY_MONTH_END_DAY + 1)
    return start, end


def period_date_error(start: date, end: date) -> str | None:
    if not (MIN_PERIOD_YEAR <= start.year <= MAX_PERIOD_YEAR and
            MIN_PERIOD_YEAR <= end.year <= MAX_PERIOD_YEAR):
        return "Pay-period dates must be between 2000 and 2100. Check the four-digit year."
    if end < start:
        return "The end date is before the start date."
    if (end - start).days >= MAX_PERIOD_DAYS:
        return "A pay period must cover no more than 366 calendar days. Check the start and end dates."
    return None
