"""Shared weekday/weekend policy for entry validation and reviewer warnings."""
from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from ..core.settings import get_setting


HOUR_POLICY_CODES = {"DAILY_HOURS", "WEEKLY_HOURS", "SATURDAY_HOURS", "SUNDAY_WORK"}


def hour_limits(db: Session) -> dict[str, Decimal]:
    return {
        "daily_hours": Decimal(str(get_setting(db, "max_daily_hours"))),
        "weekly_hours": Decimal(str(get_setting(db, "max_weekly_hours"))),
        "saturday_min_hours": Decimal(str(get_setting(db, "saturday_min_hours"))),
        "saturday_max_hours": Decimal(str(get_setting(db, "saturday_max_hours"))),
    }


def day_hours_violation(day: date, total: Decimal, limits: dict[str, Decimal]) -> dict | None:
    if day.weekday() == 6:
        code, message = "SUNDAY_WORK", "Sunday work-log entries are not allowed."
    elif day.weekday() == 5:
        minimum, maximum = limits["saturday_min_hours"], limits["saturday_max_hours"]
        if minimum <= total <= maximum:
            return None
        code, message = "SATURDAY_HOURS", f"Saturday weekend clinics require {minimum}–{maximum} total hours (this date would total {total})."
    elif total > limits["daily_hours"]:
        code, message = "DAILY_HOURS", f"Weekday hours may not exceed {limits['daily_hours']} per day (this date would total {total})."
    else:
        return None
    return {"date": str(day), "code": code, "message": message}
