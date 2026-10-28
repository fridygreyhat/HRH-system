"""Scoped catalog and immutable entry definitions for v2 work logs."""
from copy import deepcopy
from types import SimpleNamespace

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder

from ..models import ActivityRate, Cadre, CadreFormField, StaffAssignment, WorkLogEntry, PayPeriod
from .activities import ACTIVITIES, CASCADES, activity_for
from .chw_forms import CHW_GROUPS, chw_builtins
from .data_clerk_forms import DATA_CLERK_KEYS, clerk_metadata, data_clerk_builtins

HCP_DAILY_CASCADES = {"opd_screening", "ctc_art_refills", "laboratory"}


def payroll_attendance(cadre_id):
    return {
        "key": "daily_attendance", "label_en": "Daily attendance", "label_sw": "Mahudhurio ya kila siku",
        "item_type": "PAYROLL", "form_mode": "SINGLE", "hours_input": True,
        "fields": [], "required_fields": [], "field_definitions": [], "rate_value": None,
        "currency": "TZS", "unit_type": "PER_HOUR", "billable_field": None, "cadre_id": cadre_id,
    }


def attendance_only(activity):
    """Remove indicator requirements without modifying recorded rate snapshots."""
    result = deepcopy(activity)
    result.update(fields=[], required_fields=[], field_definitions=[], groups=[], cascade_pairs=[])
    return result


def chw_daily_fields(db, activity, cadre_id):
    """Restore the daily reporting form, retaining any immutable financial terms."""
    result = deepcopy(activity)
    daily = next(item for item in builtins(db, cadre_id) if item["key"] == "chw_daily_timesheet")
    for key in ("fields", "required_fields", "field_definitions", "groups", "form_mode", "hours_input"):
        result[key] = deepcopy(daily[key])
    return result


def reporting_fields(db, activity, cadre_id):
    """Restore reporting metadata without changing recorded financial terms."""
    code = db.get(Cadre, cadre_id).code
    key = activity.get("source_key") or activity["key"]
    target = {"CHW": "chw_daily_timesheet", "DATA_CLERK": "data_clerk_daily_timesheet"}.get(code) if key == "daily_attendance" else key
    daily = next((item for item in builtins(db, cadre_id)
                  if item["key"] == target and item["item_type"] == "PAYROLL"), None)
    if not daily:
        return deepcopy(activity)
    result = deepcopy(activity)
    for name in ("fields", "required_fields", "field_definitions", "groups", "form_mode", "hours_input", "cascade_pairs"):
        if name in daily:
            result[name] = deepcopy(daily[name])
    return result


def definition_out(row: ActivityRate) -> dict:
    fields = row.field_definitions
    result = {
        "id": row.id, "key": row.key, "label_en": row.label_en, "label_sw": row.label_sw,
        "cadre_id": row.cadre_id, "region_id": row.region_id, "item_type": row.item_type,
        "form_mode": row.form_mode, "field_definitions": fields,
        "fields": [f["key"] for f in fields], "required_fields": [f["key"] for f in fields],
        "hours_input": row.hours_input, "rate_value": str(row.rate_value), "currency": row.currency,
        "unit_type": row.unit_type, "billable_field": row.billable_field,
        "is_active": row.is_active, "effective_start_date": str(row.effective_start_date),
        "supersedes_id": row.supersedes_id,
        "source_key": row.source_key, "requires_location": row.source_key == "secondary_facility",
    }
    if row.source_key:
        result["cascade_pairs"] = CASCADES.get(row.source_key, [])
        if row.source_key == "chw_daily_timesheet":
            result["groups"] = deepcopy(CHW_GROUPS)
        elif row.source_key == "chw_weekend_clinic":
            result["cascade_pairs"] = [("chw_special_clinic_served", "chw_special_clinic_expected", "Clients served exceed expected attendees")]
        elif row.source_key in DATA_CLERK_KEYS:
            clerk_metadata(result)
    elif row.form_mode == "CASCADE" and len(fields) == 4:
        result["cascade_pairs"] = [(fields[index]["key"], fields[index - 1]["key"], "A downstream cascade total exceeds its upstream total") for index in range(1, 4)]
    return result


def builtins(db, cadre_id: int) -> list[dict]:
    cadre = db.get(Cadre, cadre_id)
    fields = {f.key: {"key": f.key, "label_en": f.label_en, "label_sw": f.label_sw, "field_type": f.field_type, "sort_order": f.sort_order, "is_active": True}
              for f in db.query(CadreFormField).filter(CadreFormField.cadre_id == cadre_id)}
    result = []
    if cadre.code == "CHW":
        return chw_builtins(fields, cadre_id)
    if cadre.code == "DATA_CLERK":
        return data_clerk_builtins(fields, cadre_id)
    for original in ACTIVITIES.get(cadre.code, []):
        item = deepcopy(original)
        item.update(item_type="SERVICES", form_mode="CASCADE" if len(item["fields"]) > 1 else "SINGLE",
                    field_definitions=[fields[key] for key in item["fields"]], hours_input=False,
                    rate_value=None, currency="TZS", unit_type="PER_UNIT", billable_field=item["fields"][-1], cadre_id=cadre_id)
        if cadre.code == "HCP":
            # Part B belongs to the daily timesheet; Part A remains outreach.
            # Do not change legacy definitions or immutable saved snapshots.
            if item["key"] == "index_testing":
                item["fields"] = ["hcp_index_appointments", "clients_tested_index",
                                  "hcp_index_positive", "hiv_positive_linked_art"]
            item.update(
                item_type="PAYROLL" if item["key"] in HCP_DAILY_CASCADES else "SERVICES",
                hours_input=False,
                required_fields=list(item["fields"]),
                field_definitions=[fields[key] for key in item["fields"]],
                billable_field=item["fields"][-1],
            )
        item["cascade_pairs"] = CASCADES.get(item["key"], [])
        item["requires_location"] = item["key"] == "secondary_facility"
        result.append(item)
    if cadre.code == "HCP":
        return result
    result.append({
        "key": "daily_attendance", "label_en": "Daily attendance", "label_sw": "Mahudhurio ya kila siku",
        "item_type": "PAYROLL", "form_mode": "SINGLE", "hours_input": True,
        "fields": [], "required_fields": [], "field_definitions": [], "rate_value": None,
        "currency": "TZS", "unit_type": "PER_HOUR", "billable_field": None, "cadre_id": cadre_id,
    })
    return result


def catalog_for_log(db, log) -> list[dict]:
    reporting = log.work_type == "PAYROLL" and db.get(Cadre, log.cadre_id).code in {"CHW", "HCP", "DATA_CLERK"}
    if log.workflow_version < 2:
        if reporting:
            return [item for item in builtins(db, log.cadre_id) if item["item_type"] == "PAYROLL"]
        result = deepcopy(ACTIVITIES.get(db.get(Cadre, log.cadre_id).code, []))
        return result
    assignment = db.get(StaffAssignment, log.assignment_id)
    result = [item for item in builtins(db, log.cadre_id) if item["item_type"] == log.work_type]
    rows = db.query(ActivityRate).filter(
        ActivityRate.cadre_id == log.cadre_id, ActivityRate.region_id == assignment.region_id,
        ActivityRate.item_type == log.work_type,
    ).order_by(ActivityRate.label_en).all()
    period = db.get(PayPeriod, log.period_id)
    for row in rows:
        successor = db.query(ActivityRate).filter(ActivityRate.supersedes_id == row.id).first()
        if row.effective_start_date <= period.end_date and (not successor or successor.effective_start_date > period.start_date):
            item = definition_out(row)
            item["effective_end_date"] = str(successor.effective_start_date) if successor else None
            result.append(item)
    keys = {item["key"] for item in result}
    for entry in db.query(WorkLogEntry).filter(WorkLogEntry.work_log_id == log.id):
        if entry.activity_snapshot and entry.activity_key not in keys:
            result.append(deepcopy(entry.activity_snapshot))
            keys.add(entry.activity_key)
        for extra in (entry.activity_snapshot or {}).get("additional_services", []):
            if extra["activity"]["key"] not in keys:
                result.append(deepcopy(extra["activity"]))
                keys.add(extra["activity"]["key"])
    if log.work_type == "PAYROLL":
        if reporting:
            result = [reporting_fields(db, item, log.cadre_id) for item in result]
        else:
            result = [attendance_only(item) for item in result]
            if not any(item["key"] == "daily_attendance" for item in result):
                result.insert(0, payroll_attendance(log.cadre_id))
    return result


def resolve_activity(db, log, key: str, day, existing=None) -> dict:
    chw_payroll = log.work_type == "PAYROLL" and db.get(Cadre, log.cadre_id).code == "CHW"
    code = db.get(Cadre, log.cadre_id).code
    if log.work_type == "PAYROLL" and code in {"HCP", "DATA_CLERK"}:
        if code == "HCP" and key == "daily_attendance":
            raise HTTPException(422, "Choose the HCP daily activity cascade before saving.")
        if existing and existing.activity_key == key and existing.activity_snapshot:
            activity = existing.activity_snapshot
        elif key == "daily_attendance":
            activity = payroll_attendance(log.cadre_id)
        elif log.workflow_version < 2:
            activity = next((item for item in builtins(db, log.cadre_id)
                             if item["key"] == key and item["item_type"] == "PAYROLL"), None)
            if activity is None:
                raise HTTPException(422, "Choose a daily timesheet activity for your cadre.")
        else:
            activity = _resolve_activity(db, log, key, day, existing)
        return reporting_fields(db, activity, log.cadre_id)
    if chw_payroll and key in {"daily_attendance", "chw_daily_timesheet"}:
        if existing and existing.activity_key == key and existing.activity_snapshot:
            activity = existing.activity_snapshot
        elif key == "daily_attendance":
            activity = payroll_attendance(log.cadre_id)
        else:
            activity = next(item for item in builtins(db, log.cadre_id) if item["key"] == key)
        return chw_daily_fields(db, activity, log.cadre_id)
    if log.workflow_version >= 2 and log.work_type == "PAYROLL" and key == "daily_attendance":
        return payroll_attendance(log.cadre_id)
    activity = _resolve_activity(db, log, key, day, existing)
    return attendance_only(activity) if log.work_type == "PAYROLL" and not chw_payroll else activity


def _resolve_activity(db, log, key: str, day, existing=None) -> dict:
    if log.workflow_version < 2:
        item = activity_for(db.get(Cadre, log.cadre_id).code, key)
        if not item:
            raise HTTPException(422, "Choose an activity available for your cadre")
        return deepcopy(item)
    if existing and existing.activity_key == key and existing.activity_snapshot:
        return deepcopy(existing.activity_snapshot)
    assignment = db.get(StaffAssignment, log.assignment_id)
    custom = db.query(ActivityRate).filter(ActivityRate.key == key).first()
    if custom:
        successor = db.query(ActivityRate).filter(ActivityRate.supersedes_id == custom.id).first()
        expired = successor and day >= successor.effective_start_date
        if expired or (not custom.is_active and not successor) or custom.cadre_id != log.cadre_id or custom.region_id != assignment.region_id or custom.item_type != log.work_type:
            raise HTTPException(422, "This activity is not eligible for this log's Region × Cadre and work type")
        if custom.effective_start_date > day:
            raise HTTPException(422, "This activity rate is not yet effective on the selected date")
        return jsonable_encoder(definition_out(custom))
    item = next((item for item in builtins(db, log.cadre_id) if item["key"] == key and item["item_type"] == log.work_type), None)
    if not item:
        raise HTTPException(422, "Choose an eligible activity for this log's work type")
    return item


def log_fields(db, log):
    if log.workflow_version < 2:
        return db.query(CadreFormField).filter(CadreFormField.cadre_id == log.cadre_id, CadreFormField.is_active.is_(True)).all()
    fields = {}
    for activity in catalog_for_log(db, log):
        for index, field in enumerate(activity.get("field_definitions", [])):
            fields[field["key"]] = SimpleNamespace(**{
                **field, "sort_order": field.get("sort_order", index), "is_active": True,
            })
    return list(fields.values())
