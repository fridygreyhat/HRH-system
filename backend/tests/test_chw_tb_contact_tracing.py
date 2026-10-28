from datetime import date, timedelta

from backend.services.chw_forms import CHW_TB_CONTACT_FIELDS
from backend.tests.test_chw_timesheet import new_workflow


def test_chw_tb_contact_tracing_counts_and_daily_rate_template(api, db, period, new_workflow):
    from backend.models import Cadre, CadreFormField
    cadre_id = db.query(Cadre.id).filter_by(code="CHW").scalar()
    # Existing installations do not have these new seed rows. The versioned
    # catalog must render and validate this service without a data migration.
    db.query(CadreFormField).filter(CadreFormField.cadre_id == cadre_id,
        CadreFormField.key.in_([field[0] for field in CHW_TB_CONTACT_FIELDS])).delete(synchronize_session=False)
    db.commit()
    log = api.post("/worklogs", "chw1", {"period_id": period["id"], "work_type": "SERVICES"})
    service = next(item for item in log["cadre"]["activities"] if item["key"] == "chw_tb_contact_tracing")
    keys = [field[0] for field in CHW_TB_CONTACT_FIELDS]
    assert service["fields"] == service["required_fields"] == keys
    assert [field["label_en"] for field in service["field_definitions"]] == [field[1] for field in CHW_TB_CONTACT_FIELDS]
    assert all(field["field_type"] == "INTEGER" for field in service["field_definitions"])
    assert service["unit_type"] == "PER_DAY" and service["rate_value"] is None
    day = date.fromisoformat(period["start_date"])
    if day.weekday() == 6:
        day += timedelta(days=1)
    path = f"/worklogs/{log['id']}/entries/{day}"
    values = dict(zip(keys, (20, 15, 5, 7, 3)))
    payload = {"activity_key": service["key"], "hours_worked": 4, "measures": values}
    api.put(path, "chw1", {**payload, "measures": {key: value for key, value in values.items() if key != keys[-1]}}, expect=422)
    api.put(path, "chw1", {**payload, "measures": {**values, keys[0]: -1}}, expect=422)
    api.put(path, "chw1", {**payload, "measures": {**values, keys[0]: 1.5}}, expect=422)
    saved = api.put(path, "chw1", payload)
    entry = next(row for row in saved["entries"] if row["entry_date"] == str(day))
    assert {key: float(value) for key, value in entry["measures"].items()} == values
    assert entry["activity_snapshot"]["label_en"] == "TB Contact tracing"
    payroll = api.post("/worklogs", "chw1", {"period_id": period["id"], "work_type": "PAYROLL"})
    assert service["key"] not in {item["key"] for item in payroll["cadre"]["activities"]}
    hcp = api.post("/worklogs", "hcp1", {"period_id": period["id"], "work_type": "SERVICES"})
    assert service["key"] not in {item["key"] for item in hcp["cadre"]["activities"]}
    templates = api.get("/rates/templates", "tofficer1")["templates"]
    assert any(item["key"] == service["key"] for item in templates)
    rate = api.post("/rates", "tofficer1", {
        "cadre_id": log["cadre"]["id"], "region_id": log["assignment"]["region_id"],
        "item_type": "SERVICES", "template_key": service["key"],
        "label_en": "TB Contact tracing", "label_sw": service["label_sw"],
        "form_mode": "CASCADE", "rate_value": 100, "unit_type": "PER_DAY",
        "effective_start_date": period["start_date"],
    })
    assert [field["key"] for field in rate["field_definitions"]] == keys
    updated = api.put(path, "chw1", {**payload, "activity_key": rate["key"]})
    rated = next(row for row in updated["entries"] if row["entry_date"] == str(day))
    assert float(rated["activity_snapshot"]["rate_value"]) == 100
    assert rated["activity_snapshot"]["unit_type"] == "PER_DAY"
