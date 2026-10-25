"""HCP daily facility cascades and separate date-specific outreach services."""
import pytest


@pytest.mark.parametrize("kind,keys", [
    ("PAYROLL", {"opd_screening", "ctc_art_refills", "laboratory"}),
    ("SERVICES", {"index_testing", "sns_rnr_testing", "tb_contact_tracing",
                  "weekend_clinic", "tb_active_case_finding", "inmate_tb_screening"}),
])
def test_hcp_catalog_matches_attachment(api, db, period, monkeypatch, kind, keys):
    from backend.core import workflow_policy
    monkeypatch.setattr(workflow_policy, "NEW_RECORD_WORKFLOW_VERSION", 2)
    log = api.post("/worklogs", "hcp1", {"period_id": period["id"], "work_type": kind})
    activities = log["cadre"]["activities"]
    assert {item["key"] for item in activities} == keys
    for item in activities:
        assert item["required_fields"] == item["fields"]
        assert item["hours_input"] is False
    day = period["start_date"]
    item = activities[0]
    payload = {"activity_key": item["key"], "start_time": "08:00", "end_time": "09:00",
               "measures": {key: 0 for key in item["fields"]}}
    saved = api.put(f"/worklogs/{log['id']}/entries/{day}", "hcp1", payload)
    entry = saved["entries"][0]
    assert entry["activity_key"] == item["key"]
    assert float(entry["hours_worked"]) == 1
    assert not entry["evidence_text"]
    assert not entry["comment"]
    api.call("PUT", f"/worklogs/{log['id']}/entries/{day}", "hcp1",
             json={**payload, "measures": {}}, expect=422)
    other = "opd_screening" if kind == "SERVICES" else "index_testing"
    api.call("PUT", f"/worklogs/{log['id']}/entries/{day}", "hcp1",
             json={**payload, "activity_key": other}, expect=422)


def test_hcp_daily_and_outreach_same_date_preserve_history(api, db, period, monkeypatch):
    from backend.core import workflow_policy
    monkeypatch.setattr(workflow_policy, "NEW_RECORD_WORKFLOW_VERSION", 2)
    logs = [api.post("/worklogs", "hcp1", {"period_id": period["id"], "work_type": kind})
            for kind in ("PAYROLL", "SERVICES")]
    day = period["start_date"]
    for index, log in enumerate(logs):
        activity = log["cadre"]["activities"][0]
        payload = {"activity_key": activity["key"], "start_time": f"{8 + index:02d}:00",
                   "end_time": f"{9 + index:02d}:00",
                   "measures": {key: 0 for key in activity["fields"]}}
        saved = api.put(f"/worklogs/{log['id']}/entries/{day}", "hcp1",
                        {**payload, "evidence_text": "Previously recorded evidence", "comment": "Existing note"})
        saved = api.put(f"/worklogs/{log['id']}/entries/{day}", "hcp1", payload)
        assert saved["entries"][0]["evidence_text"] == "Previously recorded evidence"
        assert saved["entries"][0]["comment"] == "Existing note"
    assert logs[0]["id"] != logs[1]["id"]


def test_data_clerks_no_longer_require_evidence(api, period):
    from .conftest import ENTRY
    log = api.post("/worklogs", "clerk1", {"period_id": period["id"]})
    payload = ENTRY["DATA_CLERK"](None)
    payload.pop("evidence_text", None)
    api.call("PUT", f"/worklogs/{log['id']}/entries/{period['start_date']}", "clerk1",
             json=payload, expect=200)
