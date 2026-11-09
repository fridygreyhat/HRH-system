"""Minimum days a provider should work on each service in a pay month. Shown and flagged; it never blocks work or pay."""
from collections import defaultdict

from ..core.period_dates import pay_month_of, pay_month_range, period_date_error
from ..models import ActivityRate, PayPeriod, WorkLog, WorkLogEntry
from .activity_catalog import catalog_for_log


def current_minimums(db, log):
    """One minimum per service name, from its newest version in this period. Revisions change the key, not the name."""
    versions = {}
    for item in catalog_for_log(db, log):
        if item.get("min_days_per_month") is None:
            continue
        newest = versions.get(item["label_en"])
        if newest is None or item["effective_start_date"] > newest["effective_start_date"]:
            versions[item["label_en"]] = item
    return {name: item for name, item in versions.items() if item["min_days_per_month"]}


def monthly_minimums(db, end):
    """{(cadre, region): {service: minimum}} from one query, for reports that cover many providers."""
    rows = (db.query(ActivityRate).filter(ActivityRate.item_type == "SERVICES", ActivityRate.min_days_per_month.is_not(None),
                                          ActivityRate.effective_start_date <= end)
            .order_by(ActivityRate.effective_start_date, ActivityRate.id))
    result = defaultdict(dict)
    for row in rows:  # newest last, so a revision replaces the version before it
        result[(row.cadre_id, row.region_id)][row.label_en] = row.min_days_per_month
    return {scope: {name: days for name, days in services.items() if days} for scope, services in result.items()}


def days_by_service(db, log, start, end):
    entries = (db.query(WorkLogEntry).join(WorkLog, WorkLog.id == WorkLogEntry.work_log_id).join(PayPeriod, PayPeriod.id == WorkLog.period_id)
               .filter(WorkLog.staff_id == log.staff_id, WorkLog.work_type == "SERVICES", WorkLog.status != "CANCELLED", PayPeriod.status != "ARCHIVED",
                       WorkLogEntry.entry_date >= start, WorkLogEntry.entry_date <= end))
    days = defaultdict(set)
    for entry in entries:
        snapshot = entry.activity_snapshot or {}
        for name in [snapshot.get("label_en"), *(extra["activity"].get("label_en") for extra in snapshot.get("additional_services", []))]:
            days[name].add(entry.entry_date)
    return days


def progress(db, log):
    if log.work_type != "SERVICES" or log.workflow_version < 2:
        return []
    period = db.get(PayPeriod, log.period_id)
    if period_date_error(period.start_date, period.end_date):
        return []
    days = days_by_service(db, log, *pay_month_range(pay_month_of(period.end_date)))
    rows = []
    for name, item in sorted(current_minimums(db, log).items()):
        done, minimum = len(days[name]), item["min_days_per_month"]
        rows.append({"service": name, "service_sw": item["label_sw"], "min_days": minimum, "days": done, "left": max(minimum - done, 0)})
    return rows
