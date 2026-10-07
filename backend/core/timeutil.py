from datetime import date, datetime
from zoneinfo import ZoneInfo

from . import config

TZ = ZoneInfo(config.TIMEZONE)


def local_today() -> date:
    """Today in the operational timezone (Africa/Dar_es_Salaam by default)."""
    return datetime.now(TZ).date()
