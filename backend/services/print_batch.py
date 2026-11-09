"""Many timesheets printed as one set: a register of every provider, then each provider's paper form.

The form data matches what one work log's print view uses, limited to the chosen pay month. Signer names follow the
same rule as the single print view: only roles that may read the audit trail see who signed and when.
"""
from collections import defaultdict

from ..core.audit_access import can_view_audit
from ..core.period_dates import pay_month_range
from ..core.serialize import to_dict
from ..models import PayPeriod, Staff, StaffAssignment, User, WorkLog, WorkLogAudit, WorkLogEntry, WorkLogMeasure
from . import public_holidays, service_targets
from .forms import assignment_out, log_cadre_out

LIMIT = 500  # the review list's own limit
SIGN_OFF_ACTIONS = ("submit", "verify", "confirm_otp", "facility_endorse", "endorse", "authorize")
ENTRY_FIELDS = ("id", "entry_date", "start_time", "end_time", "hours_worked", "activity_key", "activity_location",
                "activity_snapshot", "comment")


def _paper_form(cadre: dict) -> dict:
    """Only what the paper form prints: a full activity catalogue is several KB per timesheet."""
    keep = ("id", "code", "name", "form_title", "hours_mode", "requires_facility_endorsement")
    return {**{key: cadre.get(key) for key in keep},
            "fields": [{key: field.get(key) for key in ("key", "label_en", "label_sw", "field_type")} for field in cadre["fields"]],
            "activities": [{"key": item["key"], "label_en": item.get("label_en")} for item in cadre.get("activities") or []]}


def _paper_snapshot(snapshot: dict | None) -> dict:
    """An entry's frozen form copy is ~5 KB; the paper only shows the extra services done that day."""
    extras = (snapshot or {}).get("additional_services") or []
    return {"additional_services": [{"activity": {"label_en": (extra.get("activity") or {}).get("label_en")},
                                     "measures": extra.get("measures") or {}, "activity_location": extra.get("activity_location")}
                                    for extra in extras]}


def build(db, current, logs: list[WorkLog], month: str) -> dict:
    start, end = pay_month_range(month)
    ids = [log.id for log in logs]
    entries, measures = defaultdict(list), defaultdict(dict)
    if ids:
        rows = (db.query(WorkLogEntry).filter(WorkLogEntry.work_log_id.in_(ids), WorkLogEntry.entry_date.between(start, end))
                .order_by(WorkLogEntry.entry_date).all())
        for entry in rows:
            entries[entry.work_log_id].append(entry)
        for measure in db.query(WorkLogMeasure).filter(WorkLogMeasure.entry_id.in_([entry.id for entry in rows] or [-1])):
            measures[measure.entry_id][measure.field_key] = measure.value
    sign_offs = defaultdict(list)
    if ids and can_view_audit(current):
        for row, name in (db.query(WorkLogAudit, User.full_name).outerjoin(User, User.id == WorkLogAudit.actor_id)
                          .filter(WorkLogAudit.work_log_id.in_(ids), WorkLogAudit.action.in_(SIGN_OFF_ACTIONS))
                          .order_by(WorkLogAudit.timestamp, WorkLogAudit.id)):
            sign_offs[row.work_log_id].append({"action": row.action, "actor_name": name, "timestamp": row.timestamp,
                                               "comment": row.comment})
    staff = {person.id: person for person in db.query(Staff).filter(Staff.id.in_({log.staff_id for log in logs} or {-1}))}
    placements, periods = {}, {}

    def placement(assignment_id):
        if assignment_id not in placements:
            placements[assignment_id] = assignment_out(db, db.get(StaffAssignment, assignment_id))
        return placements[assignment_id]

    def period(period_id):
        if period_id not in periods:
            row = db.get(PayPeriod, period_id)
            periods[period_id] = {**to_dict(row), "holidays": public_holidays.for_period(db, row)}
        return periods[period_id]

    printed = []
    for log in logs:
        person, where = staff[log.staff_id], placement(log.assignment_id)
        cadre = _paper_form(log_cadre_out(db, log))
        rows = [{**{key: getattr(entry, key) for key in ENTRY_FIELDS}, "activity_snapshot": _paper_snapshot(entry.activity_snapshot),
                 "measures": measures[entry.id]} for entry in entries[log.id]]
        printed.append({
            "id": log.id, "status": log.status, "version": log.version, "work_type": log.work_type,
            "attested_at": log.attested_at, "period_comment": log.period_comment,
            "occupation": log.occupation, "occupation_other": log.occupation_other, "section": log.section,
            "staff": {"id": person.id, "name": person.legal_name, "first_name": person.first_name, "middle_name": person.middle_name,
                      "last_name": person.last_name, "salary_scale": person.salary_scale},
            "cadre": cadre, "assignment": where, "period": period(log.period_id),
            "service_targets": service_targets.progress(db, log),
            "entries": rows, "audit": sign_offs[log.id],
            "days": len(rows), "hours": sum((entry.hours_worked or 0) for entry in entries[log.id]),
        })
    printed.sort(key=lambda item: (item["assignment"]["region"] or "", item["assignment"]["facility"] or item["assignment"]["community_area"] or "",
                                   item["cadre"]["code"], item["staff"]["last_name"] or "", item["staff"]["first_name"] or "", item["id"]))
    return {"month": month, "start": start, "end": end, "printed_by": current.user.full_name, "logs": printed}
