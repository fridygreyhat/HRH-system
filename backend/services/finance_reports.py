"""Pay-month finance reports (26th to 25th). Never expose daily clinical rows; daily=True adds attendance times only."""
from decimal import Decimal

from fastapi import HTTPException

from ..models import Cadre, CommunityArea, Facility, Region, Staff, StaffAssignment, WorkLog, WorkLogEntry, WorkLogMeasure
from ..core.period_dates import pay_month_range
from ..core.workflow_policy import RM_AUTHORIZED_STATUSES as RM_AUTHORIZED
from .forms import cadre_fields
from .scope import worklog_visibility
from .v22_scope import record_condition

def record_attendance(days, entry):
    """One row per date: when and how long, with no activity, indicator or location detail."""
    day = days.setdefault(entry.entry_date.isoformat(), {
        "date": entry.entry_date.isoformat(), "start": None, "end": None, "hours": Decimal(0)})
    day["hours"] += entry.hours_worked
    if entry.start_time:
        start = entry.start_time.strftime("%H:%M")
        day["start"] = min(day["start"] or start, start)
    if entry.end_time:
        end = entry.end_time.strftime("%H:%M")
        day["end"] = max(day["end"] or end, end)


def monthly_summary(db, current, month, region_id, work_type, organization_id=None, daily=False):
    year, number = map(int, month.split("-"))
    if not 2000 <= year <= 2100:
        raise HTTPException(422, "Select a month between 2000 and 2100.")
    start, end = pay_month_range(month)
    query = (
        db.query(WorkLogEntry, WorkLog, Staff, Cadre, StaffAssignment, Region, Facility, CommunityArea)
        .join(WorkLog, WorkLog.id == WorkLogEntry.work_log_id)
        .join(Staff, Staff.id == WorkLog.staff_id)
        .join(Cadre, Cadre.id == WorkLog.cadre_id)
        .join(StaffAssignment, StaffAssignment.id == WorkLog.assignment_id)
        .join(Region, Region.id == StaffAssignment.region_id)
        .outerjoin(Facility, Facility.id == StaffAssignment.facility_id)
        .outerjoin(CommunityArea, CommunityArea.id == StaffAssignment.community_area_id)
        .filter(
            worklog_visibility(current),
            record_condition(current, WorkLog.assignment_id, WorkLog.cadre_id),
            WorkLog.work_type == work_type,
            WorkLog.status.in_(RM_AUTHORIZED),
            # Legacy BUDGET_HOLD can be an RM hold, not finance-authorized work.
            (WorkLog.status != "BUDGET_HOLD") | WorkLog.approved_at.is_not(None),
            WorkLogEntry.entry_date >= start, WorkLogEntry.entry_date <= end,
        )
    )
    if region_id:
        query = query.filter(StaffAssignment.region_id == region_id)
    if organization_id is not None:
        query = query.filter(StaffAssignment.organization_id == organization_id)
    rows = query.order_by(Cadre.code, Staff.first_name, Staff.last_name, Region.name, WorkLogEntry.id).all()
    measures = {}
    if rows:
        for measure in db.query(WorkLogMeasure).filter(WorkLogMeasure.entry_id.in_([r[0].id for r in rows])):
            measures.setdefault(measure.entry_id, {})[measure.field_key] = measure.value
    labels = {
        c.id: {f.key: f.label_en for f in cadre_fields(db, c.id, include_inactive=True)}  # hidden questions keep their labels
        for c in {row[3].id: row[3] for row in rows}.values()
    }
    providers, cadres, log_ids = {}, {}, set()
    for entry, log, staff, cadre, assignment, region, facility, area in rows:
        log_ids.add(log.id)
        key = (staff.id, cadre.id, region.id, assignment.facility_id, assignment.community_area_id)
        provider = providers.setdefault(key, {
            "staff_id": staff.id, "provider_name": staff.legal_name,
            "cadre_code": cadre.code, "cadre_name": cadre.name,
            "facility_name": facility.name if facility else "Not assigned",
            "region_name": region.name, "_dates": set(), "_logs": set(), "_hours": Decimal(0), "_indicators": {},
            "_attendance": {}, "_salary_scale": staff.salary_scale, "_signed_dates": set(),
            "_community_area": area.name if area else None,
        })
        group = cadres.setdefault(cadre.id, {
            "code": cadre.code, "name": cadre.name, "_staff": set(), "_dates": set(),
            "_hours": Decimal(0), "_indicators": {},
        })
        provider["_dates"].add(entry.entry_date)
        provider["_logs"].add(log.id)
        record_attendance(provider["_attendance"], entry)
        if log.attested_at:
            provider["_signed_dates"].add(entry.entry_date)
        group["_dates"].add((staff.id, entry.entry_date))
        group["_staff"].add(staff.id)
        for target in (provider, group):
            target["_hours"] += entry.hours_worked
        activity = entry.activity_snapshot or {}
        items = [(activity, measures.get(entry.id, {}))]
        items.extend((service.get("activity", {}), service.get("measures", {}))
                     for service in activity.get("additional_services", []))
        for definition, values in items:
            field_labels = {f["key"]: f.get("label_en", f["key"])
                            for f in definition.get("field_definitions", []) if f.get("key")}
            for field, value in values.items():
                if value is None:
                    continue
                amount = Decimal(int(value)) if isinstance(value, bool) else Decimal(str(value))
                label = field_labels.get(field, labels[cadre.id].get(field, field.replace("_", " ").capitalize()))
                for target in (provider, group):
                    indicator = target["_indicators"].setdefault(field, {"key": field, "label": label, "total": Decimal(0)})
                    indicator["total"] += amount

    def output(item):
        result = {k: v for k, v in item.items() if not k.startswith("_")}
        result.update(days=len(item["_dates"]), hours=str(item["_hours"]),
                      indicators=[{**value, "total": str(value["total"])}
                                  for _, value in sorted(item["_indicators"].items())])
        if "_staff" in item:
            result["provider_count"] = len(item["_staff"])
        if "_logs" in item:
            result["logs"] = len(item["_logs"])
        if daily and "_attendance" in item:
            result["salary_scale"] = item["_salary_scale"]
            result["community_area_name"] = item["_community_area"]
            result["days_signed"] = len(item["_signed_dates"])
            result["attendance"] = [{**day, "hours": str(day["hours"])} for _, day in sorted(item["_attendance"].items())]
        return result

    return {
        "month": month, "work_type": work_type,
        "totals": {"providers": len({key[0] for key in providers}), "logs": len(log_ids),
                   "days": sum(len(group["_dates"]) for group in cadres.values()),
                   "hours": str(sum((p["_hours"] for p in providers.values()), Decimal(0)))},
        "providers": [output(item) for item in providers.values()],
        "cadres": [output(item) for item in cadres.values()],
    }
