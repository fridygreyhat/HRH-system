"""Cadre form templates, server-side totals and frozen review snapshots."""
from decimal import Decimal

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
        "uses_section": cadre.uses_section,
        "occupation_options": cadre.occupation_options,
        "is_active": cadre.is_active,
        "fields": [field_out(f) for f in cadre_fields(db, cadre.id, include_inactive)],
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
