"""Shared weekday/weekend policy for entry validation and reviewer warnings."""
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy.orm import Session

from ..core.settings import get_setting


HOUR_POLICY_CODES = {"DAILY_HOURS", "WEEKLY_HOURS", "SATURDAY_HOURS", "SUNDAY_WORK"}


def hours_text(value) -> str:
    """Hours as people write them: 8, 7 h 30 min, 41 h 40 min. Never 8.0 or 8.333333."""
    minutes = int((Decimal(str(value)) * 60).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    hours, remainder = divmod(minutes, 60)
    return f"{hours} h {remainder} min" if remainder else str(hours)


def hour_limits(db: Session, work_type: str = "SERVICES") -> dict[str, Decimal]:
    limits = {
        "daily_hours": Decimal(str(get_setting(db, "max_daily_hours"))),
        "weekly_hours": Decimal(str(get_setting(db, "max_weekly_hours"))),
        "saturday_min_hours": Decimal(str(get_setting(db, "saturday_min_hours"))),
        "saturday_max_hours": Decimal(str(get_setting(db, "saturday_max_hours"))),
    }
    if work_type == "PAYROLL":
        # Payroll attendance is independent of additional Services on that date.
        limits["daily_hours"] = min(limits["daily_hours"], Decimal(8))
        limits["weekly_hours"] = min(limits["weekly_hours"], Decimal(40))
        limits["saturday_max_hours"] = min(limits["saturday_max_hours"], Decimal(8))
        limits["saturday_min_hours"] = min(limits["saturday_min_hours"], limits["saturday_max_hours"])
    return limits


def day_hours_violation(day: date, total: Decimal, limits: dict[str, Decimal]) -> dict | None:
    if day.weekday() == 6:
        code, message = "SUNDAY_WORK", "Sunday work-log entries are not allowed."
    elif day.weekday() == 5:
        minimum, maximum = limits["saturday_min_hours"], limits["saturday_max_hours"]
        if minimum <= total <= maximum:
            return None
        code, message = "SATURDAY_HOURS", f"Saturday weekend clinics require {hours_text(minimum)}–{hours_text(maximum)} total hours (this date would total {hours_text(total)})."
    elif total > limits["daily_hours"]:
        code, message = "DAILY_HOURS", f"Weekday hours may not exceed {hours_text(limits['daily_hours'])} per day (this date would total {hours_text(total)})."
    else:
        return None
    return {"date": str(day), "code": code, "message": message}
