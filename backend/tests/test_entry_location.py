"""All provider cadres require captured coordinates and accuracy on every save."""
import pytest
from .conftest import ENTRY

GPS = {"gps_lat": 0, "gps_lon": 0, "gps_accuracy_m": 0}


@pytest.mark.parametrize("cadre,username", [("CHW", "chw1"), ("HCP", "hcp1"), ("DATA_CLERK", "clerk1")])
def test_location_required_for_create_and_edit(api, db, period, cadre, username):
    from backend.models import WorkLogEntry
    log = api.post("/worklogs", username, {"period_id": period["id"]})
    path = f"/worklogs/{log['id']}/entries/{period['start_date']}"
    body = ENTRY[cadre](None)
    for supplied in ({}, {"gps_lat": 0}, {"gps_lat": 0, "gps_lon": 0},
                     {"gps_lat": 0, "gps_lon": 0, "gps_accuracy_m": None}):
        api.put(path, username, {**body, **supplied}, expect=422, capture_location=False)
    assert not db.query(WorkLogEntry).filter_by(work_log_id=log["id"]).count()
    saved = api.put(path, username, {**body, **GPS}, capture_location=False)
    assert saved["entries"][0]["gps_lat"] == 0
    assert saved["entries"][0]["gps_lon"] == 0
    assert saved["entries"][0]["gps_accuracy_m"] == 0
    assert saved["entries"][0]["gps_captured_at"]
    # Previously stored coordinates cannot substitute for a new capture on edits.
    api.put(path, username, body, expect=422, capture_location=False)
    updated = api.put(path, username, {**body, **GPS, "gps_lat": -7.77}, capture_location=False)
    assert updated["entries"][0]["gps_lat"] == -7.77


@pytest.mark.parametrize("invalid", [
    {"gps_lat": 91}, {"gps_lon": -181}, {"gps_accuracy_m": -1},
    {"gps_lat": None}, {"gps_lon": None}, {"gps_accuracy_m": "Infinity"},
])
def test_invalid_location_rejected(api, period, invalid):
    log = api.post("/worklogs", "chw1", {"period_id": period["id"]})
    api.put(f"/worklogs/{log['id']}/entries/{period['start_date']}", "chw1",
            {**ENTRY["CHW"](None), **GPS, **invalid}, expect=422, capture_location=False)
