"""Calendar-month, aggregate-only finance reports; never expose daily clinical rows."""
from calendar import monthrange
from datetime import date
from decimal import Decimal

from fastapi import HTTPException

from ..models import Cadre, Facility, Region, Staff, StaffAssignment, WorkLog, WorkLogEntry, WorkLogMeasure
from .forms import cadre_fields
from .scope import worklog_visibility
from .v22_scope import record_condition

# Pending finance/routed states are included for historical, already RM-authorized work.
RM_AUTHORIZED = {"APPROVED", "PENDING_FINANCE_REVIEW", "FINANCE_REVIEWED",
                 "ROUTED_FHI360", "ROUTED_CSO", "PAID", "BUDGET_HOLD"}


def monthly_summary(db, current, month, region_id, work_type):
    year, number = map(int, month.split("-"))
    if not 2000 <= year <= 2100:
        raise HTTPException(422, "Select a month between 2000 and 2100.")
    start = date(year, number, 1)
    end = date(year, number, monthrange(year, number)[1])
    query = (
        db.query(WorkLogEntry, WorkLog, Staff, Cadre, StaffAssignment, Region, Facility)
        .join(WorkLog, WorkLog.id == WorkLogEntry.work_log_id)
        .join(Staff, Staff.id == WorkLog.staff_id)
        .join(Cadre, Cadre.id == WorkLog.cadre_id)
        .join(StaffAssignment, StaffAssignment.id == WorkLog.assignment_id)
        .join(Region, Region.id == StaffAssignment.region_id)
        .outerjoin(Facility, Facility.id == StaffAssignment.facility_id)
        .filter(
            worklog_visibility(current),
            record_condition(current, WorkLog.assignment_id, WorkLog.cadre_id),
            WorkLog.staff_id != current.staff_id,
            WorkLog.work_type == work_type,
            WorkLog.status.in_(RM_AUTHORIZED),
            # Legacy BUDGET_HOLD can be an RM hold, not finance-authorized work.
            (WorkLog.status != "BUDGET_HOLD") | WorkLog.approved_at.is_not(None),
            WorkLogEntry.entry_date >= start, WorkLogEntry.entry_date <= end,
        )
    )
    if region_id:
        query = query.filter(StaffAssignment.region_id == region_id)
    rows = query.order_by(Cadre.code, Staff.first_name, Staff.last_name, Region.name, WorkLogEntry.id).all()
    measures = {}
    if rows:
        for measure in db.query(WorkLogMeasure).filter(WorkLogMeasure.entry_id.in_([r[0].id for r in rows])):
            measures.setdefault(measure.entry_id, {})[measure.field_key] = measure.value
    labels = {
        c.id: {f.key: f.label_en for f in cadre_fields(db, c.id)}
        for c in {row[3].id: row[3] for row in rows}.values()
    }
    providers, cadres, log_ids = {}, {}, set()
    for entry, log, staff, cadre, assignment, region, facility in rows:
        log_ids.add(log.id)
        key = (staff.id, cadre.id, region.id, assignment.facility_id)
        provider = providers.setdefault(key, {
            "staff_id": staff.id, "provider_name": staff.legal_name,
            "cadre_code": cadre.code, "cadre_name": cadre.name,
            "facility_name": facility.name if facility else "Not assigned",
            "region_name": region.name, "_dates": set(), "_hours": Decimal(0), "_indicators": {},
        })
        group = cadres.setdefault(cadre.id, {
            "code": cadre.code, "name": cadre.name, "_staff": set(), "_dates": set(),
            "_hours": Decimal(0), "_indicators": {},
        })
        provider["_dates"].add(entry.entry_date)
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
        return result

    return {
        "month": month, "work_type": work_type,
        "totals": {"providers": len({key[0] for key in providers}), "logs": len(log_ids),
                   "days": sum(len(group["_dates"]) for group in cadres.values()),
                   "hours": str(sum((p["_hours"] for p in providers.values()), Decimal(0)))},
        "providers": [output(item) for item in providers.values()],
        "cadres": [output(item) for item in cadres.values()],
    }
