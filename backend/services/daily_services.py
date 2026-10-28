"""Several service records on one day; one fixed daily payment."""
from copy import deepcopy
from decimal import Decimal
from types import SimpleNamespace

from fastapi import HTTPException

from .activity_catalog import resolve_activity


def recorded_services(entry, measures):
    snapshot = entry.activity_snapshot or {}
    return [{"activity": snapshot, "measures": measures, "activity_location": entry.activity_location},
            *snapshot.get("additional_services", [])]


def validate_additional(db, log, day, primary_key, items, existing):
    if items and (log.workflow_version < 2 or log.work_type != "SERVICES"):
        raise HTTPException(422, "Additional services belong only to a Services work log.")
    seen, result = {primary_key}, []
    old = {item["activity"]["key"]: item for item in
           (existing.activity_snapshot or {}).get("additional_services", [])} if existing else {}
    for item in items:
        if item.activity_key in seen:
            raise HTTPException(422, "Record each service only once per date.")
        seen.add(item.activity_key)
        previous = old.get(item.activity_key)
        saved = SimpleNamespace(activity_key=item.activity_key, activity_snapshot=previous["activity"]) if previous else None
        activity = resolve_activity(db, log, item.activity_key, day, saved)
        if activity.get("rate_value") is not None and activity.get("unit_type") != "PER_DAY":
            raise HTTPException(422, "Revise this service to a fixed daily amount before recording new work.")
        fields = {field["key"]: field for field in activity.get("field_definitions", [])}
        if set(item.measures) - set(activity["fields"]):
            raise HTTPException(422, "An indicator does not belong to its selected service.")
        if set(activity.get("required_fields", [])) - set(item.measures):
            raise HTTPException(422, "Complete all required indicators for each additional service.")
        for key, value in item.measures.items():
            if fields[key]["field_type"] == "BOOLEAN":
                valid = isinstance(value, bool)
            else:
                valid = not isinstance(value, bool) and float(value).is_integer() and 0 <= value <= 10000
            if not valid:
                raise HTTPException(422, "Service counts must be whole numbers from 0 to 10000; checklists require Yes or No.")
        location = (item.activity_location or "").strip() or None
        if bool(location) != bool(activity.get("requires_location")):
            raise HTTPException(422, "Enter a secondary-facility name only for a service that requires one.")
        result.append({"activity": deepcopy(activity), "measures": item.measures, "activity_location": location})
    return result


def fixed_daily_lines(entry, measures):
    """Deterministic maximum, not a sum. Currency conflicts fail before selection."""
    records = recorded_services(entry, measures)
    priced = []
    errors = []
    for record in records:
        activity = record["activity"]
        if activity.get("rate_value") is None:
            errors.append(f"{entry.entry_date}: {activity.get('label_en', 'Service')} has no configured daily amount.")
        elif activity.get("unit_type") != "PER_DAY":
            errors.append(f"{entry.entry_date}: every service must have a fixed daily amount.")
        else:
            priced.append(record)
    if len({record["activity"].get("currency", "TZS") for record in priced}) > 1:
        errors.append(f"{entry.entry_date}: daily service amounts must use one currency.")
    if errors or not priced:
        return None, errors
    winner = max(priced, key=lambda record: (Decimal(str(record["activity"]["rate_value"])), record["activity"]["key"]))
    return winner, []
