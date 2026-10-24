"""Cadre form templates, server-side totals and frozen review snapshots."""
from decimal import Decimal
from collections import defaultdict
from datetime import timedelta

from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from ..models import (
    Cadre,
    CadreFormField,
    CommunityArea,
    District,
    Facility,
    PayPeriod,
    Region,
    Staff,
    StaffAssignment,
    Ward,
    WorkLog,
    WorkLogEntry,
    WorkLogMeasure,
)
from .activities import ACTIVITIES, CASCADES
from ..core.settings import get_setting


def cadre_fields(db: Session, cadre_id: int, include_inactive: bool = False) -> list[CadreFormField]:
    query = db.query(CadreFormField).filter(CadreFormField.cadre_id == cadre_id)
    if not include_inactive:
        query = query.filter(CadreFormField.is_active.is_(True))
    return query.order_by(CadreFormField.sort_order, CadreFormField.id).all()


def field_out(f: CadreFormField) -> dict:
    return {"key": f.key, "label_en": f.label_en, "label_sw": f.label_sw, "field_type": f.field_type,
            "sort_order": f.sort_order, "is_active": f.is_active}


def cadre_out(db: Session, cadre: Cadre, include_inactive: bool = False) -> dict:
    return {
        "id": cadre.id,
        "code": cadre.code,
        "name": cadre.name,
        "form_title": cadre.form_title,
        "hours_mode": cadre.hours_mode,
        "uses_facility_geofence": cadre.uses_facility_geofence,
        "requires_facility_endorsement": cadre.requires_facility_endorsement,
        "technical_reviewer_title": cadre.technical_reviewer_title,
        "uses_section": cadre.uses_section,
        "occupation_options": cadre.occupation_options,
        "is_active": cadre.is_active,
        "fields": [field_out(f) for f in cadre_fields(db, cadre.id, include_inactive)],
        "activities": ACTIVITIES.get(cadre.code, []),
    }


def _name(db: Session, model, id_):
    row = db.get(model, id_) if id_ else None
    return row.name if row else None


def assignment_out(db: Session, a: StaffAssignment | None) -> dict | None:
    if not a:
        return None
    return {
        "id": a.id,
        # ids let forms (e.g. a rotation) start from the current placement
        "region_id": a.region_id,
        "district_id": a.district_id,
        "ward_id": a.ward_id,
        "facility_id": a.facility_id,
        "community_area_id": a.community_area_id,
        "region": _name(db, Region, a.region_id),
        "district": _name(db, District, a.district_id),
        "ward": _name(db, Ward, a.ward_id),
        "facility": _name(db, Facility, a.facility_id),
        "community_area": _name(db, CommunityArea, a.community_area_id),
        "section": a.section,
        "organization_id": a.organization_id,
        "start_date": a.start_date,
        "end_date": a.end_date,
    }


def entries_with_measures(db: Session, log_id: int) -> list[tuple[WorkLogEntry, dict[str, Decimal]]]:
    entries = db.query(WorkLogEntry).filter(WorkLogEntry.work_log_id == log_id).order_by(WorkLogEntry.entry_date).all()
    measures: dict[int, dict[str, Decimal]] = {e.id: {} for e in entries}
    if entries:
        for m in db.query(WorkLogMeasure).filter(WorkLogMeasure.entry_id.in_(measures)):
            measures[m.entry_id][m.field_key] = m.value
    return [(e, measures[e.id]) for e in entries]


def totals(db: Session, log: WorkLog) -> dict:
    rows = entries_with_measures(db, log.id)
    measure_totals: dict[str, Decimal] = {f.key: Decimal(0) for f in cadre_fields(db, log.cadre_id)}
    for _, measures in rows:
        for key, value in measures.items():
            measure_totals[key] = measure_totals.get(key, Decimal(0)) + value
    return {
        "days": len(rows),
        "hours": sum((e.hours_worked for e, _ in rows), Decimal(0)),
        "measures": measure_totals,
    }


def build_snapshot(db: Session, log: WorkLog) -> dict:
    """Everything the provider confirms: header, every daily entry and the server-computed totals."""
    staff = db.get(Staff, log.staff_id)
    period = db.get(PayPeriod, log.period_id)
    cadre = db.get(Cadre, log.cadre_id)
    return jsonable_encoder({
        "work_log_id": log.id,
        "version": log.version,
        "staff": {"id": staff.id, "name": staff.legal_name, "salary_scale": staff.salary_scale},
        "cadre": cadre.code,
        "occupation": log.occupation,
        "occupation_other": log.occupation_other,
        "section": log.section,
        "assignment": assignment_out(db, db.get(StaffAssignment, log.assignment_id)),
        "period": {"start": str(period.start_date), "end": str(period.end_date), "label": period.period_label},
        "period_comment": log.period_comment,
        "entries": [
            {
                "date": str(e.entry_date),
                "activity_key": e.activity_key,
                "activity_location": e.activity_location,
                "start_time": e.start_time.isoformat() if e.start_time else None,
                "end_time": e.end_time.isoformat() if e.end_time else None,
                "hours": str(e.hours_worked),
                "evidence": e.evidence_text,
                "comment": e.comment,
                "location_status": e.location_status,
                "measures": {k: str(v) for k, v in m.items()},
            }
            for e, m in entries_with_measures(db, log.id)
        ],
        "totals": {k: (str(v) if not isinstance(v, dict) else {kk: str(vv) for kk, vv in v.items()}) for k, v in totals(db, log).items()},
    })


def review_summary(db: Session, log: WorkLog) -> dict:
    """Monthly totals and non-blocking flags for implausible measure funnels/hours."""
    rows = entries_with_measures(db, log.id)
    totals_by_key = totals(db, log)["measures"]
    daily_max = Decimal(str(get_setting(db, "max_daily_hours")))
    weekly_max = Decimal(str(get_setting(db, "max_weekly_hours")))
    period = db.get(PayPeriod, log.period_id)
    week_start = period.start_date - timedelta(days=period.start_date.weekday())
    week_end = period.end_date + timedelta(days=6 - period.end_date.weekday())
    week_hours: dict[object, Decimal] = defaultdict(Decimal)
    history = (
        db.query(WorkLogEntry.entry_date, WorkLogEntry.hours_worked)
        .join(WorkLog, WorkLog.id == WorkLogEntry.work_log_id)
        .filter(WorkLog.staff_id == log.staff_id, WorkLogEntry.entry_date >= week_start, WorkLogEntry.entry_date <= week_end)
        .all()
    )
    for day, hours in history:
        monday = day - timedelta(days=day.weekday())
        week_hours[monday] += Decimal(hours)

    anomalies = []
    fields = {f.key: f.label_en for f in cadre_fields(db, log.cadre_id)}
    for entry, measures in rows:
        if entry.hours_worked > daily_max:
            anomalies.append({"date": str(entry.entry_date), "code": "DAILY_HOURS", "message": f"{entry.hours_worked} hours exceeds the {daily_max}-hour daily limit."})
        monday = entry.entry_date - timedelta(days=entry.entry_date.weekday())
        if week_hours[monday] > weekly_max:
            anomalies.append({"date": str(entry.entry_date), "code": "WEEKLY_HOURS", "message": f"{week_hours[monday]} hours in the week exceeds the {weekly_max}-hour weekly limit."})
        for lower, upper, description in CASCADES.get(entry.activity_key, []):
            if lower in measures and upper in measures and measures[lower] > measures[upper]:
                anomalies.append({
                    "date": str(entry.entry_date), "code": "CASCADE",
                    "message": f"{fields.get(lower, lower)} exceeds {fields.get(upper, upper)}. {description}.",
                })
    activity_totals: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
    for entry, measures in rows:
        if entry.activity_key:
            for key, value in measures.items():
                activity_totals[entry.activity_key][key] += value
    for activity_key, measures in activity_totals.items():
        for lower, upper, description in CASCADES.get(activity_key, []):
            if lower in measures and upper in measures and measures[lower] > measures[upper]:
                anomalies.append({
                    "date": None, "code": "MONTHLY_CASCADE",
                    "message": f"Monthly total: {fields.get(lower, lower)} exceeds {fields.get(upper, upper)}. {description}.",
                })
    return {
        "metrics": {key: str(value) for key, value in totals_by_key.items()},
        "anomalies": anomalies,
        "limits": {"daily_hours": str(daily_max), "weekly_hours": str(weekly_max), "backdate_grace_hours": get_setting(db, "backdate_grace_hours")},
    }
