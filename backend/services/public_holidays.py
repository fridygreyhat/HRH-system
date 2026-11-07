"""Tanzania's public holidays, shown on calendars, timesheets and salary files. They change no hours or pay."""
from datetime import date, timedelta

from ..core.period_dates import period_date_error
from ..models import PublicHoliday

FIXED = (
    (1, 1, "New Year's Day", "Mwaka Mpya"),
    (1, 12, "Zanzibar Revolution Day", "Mapinduzi ya Zanzibar"),
    (4, 7, "Karume Day", "Siku ya Karume"),
    (4, 26, "Union Day", "Siku ya Muungano"),
    (5, 1, "Workers' Day", "Mei Mosi"),
    (7, 7, "Saba Saba", "Sabasaba"),
    (8, 8, "Nane Nane", "Nanenane"),
    (10, 14, "Nyerere Day", "Siku ya Nyerere"),
    (12, 9, "Independence Day", "Siku ya Uhuru"),
    (12, 25, "Christmas Day", "Krismasi"),
    (12, 26, "Boxing Day", "Siku ya Zawadi"),
)


def easter_sunday(year):
    """Anonymous Gregorian computus."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    g = (b - (b + 8) // 25 + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month, day = divmod(h + l - 7 * m + 114, 31)
    return date(year, month, day + 1)


def every_year(year):
    easter = easter_sunday(year)
    rows = [(date(year, month, day), name_en, name_sw) for month, day, name_en, name_sw in FIXED]
    rows += [(easter - timedelta(days=2), "Good Friday", "Ijumaa Kuu"), (easter + timedelta(days=1), "Easter Monday", "Jumatatu ya Pasaka")]
    return rows


def between(db, start, end):
    rows = [{"id": None, "date": day.isoformat(), "name_en": name_en, "name_sw": name_sw}
            for year in range(start.year, end.year + 1) for day, name_en, name_sw in every_year(year) if start <= day <= end]
    rows += [{"id": row.id, "date": row.holiday_date.isoformat(), "name_en": row.name_en, "name_sw": row.name_sw}
             for row in db.query(PublicHoliday).filter(PublicHoliday.holiday_date >= start, PublicHoliday.holiday_date <= end)]
    return sorted(rows, key=lambda row: row["date"])


def for_period(db, period):
    return [] if period_date_error(period.start_date, period.end_date) else between(db, period.start_date, period.end_date)
