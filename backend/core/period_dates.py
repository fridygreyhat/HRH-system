"""Bounded reporting periods prevent accidental centuries of calendar expansion."""
from datetime import date

MIN_PERIOD_YEAR = 2000
MAX_PERIOD_YEAR = 2100
MAX_PERIOD_DAYS = 366


def period_date_error(start: date, end: date) -> str | None:
    if not (MIN_PERIOD_YEAR <= start.year <= MAX_PERIOD_YEAR and
            MIN_PERIOD_YEAR <= end.year <= MAX_PERIOD_YEAR):
        return "Pay-period dates must be between 2000 and 2100. Check the four-digit year."
    if end < start:
        return "The end date is before the start date."
    if (end - start).days >= MAX_PERIOD_DAYS:
        return "A pay period must cover no more than 366 calendar days. Check the start and end dates."
    return None
