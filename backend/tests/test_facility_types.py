import pytest


@pytest.mark.parametrize("facility_type", ["PUBLIC", "POLICE", "PRISON", "PNP", "LEGACY_CUSTOM"])
def test_facility_classification_round_trip_does_not_create_funding(api, facility_type):
    funding_before = api.get("/admin/funding-sources", "central1")
    ward = api.get("/admin/wards", "central1")[0]
    created = api.post("/admin/facilities", "central1", {
        "name": f"TEST {facility_type} facility", "ward_id": ward["id"],
        "facility_type": facility_type,
    })
    assert created["facility_type"] == facility_type
    updated = api.put(f"/admin/facilities/{created['id']}", "central1", {
        **created, "name": f"TEST {facility_type} renamed",
    })
    assert updated["facility_type"] == facility_type
    listed = next(row for row in api.get("/admin/facilities", "central1") if row["id"] == created["id"])
    assert listed["facility_type"] == facility_type
    assert api.get("/admin/funding-sources", "central1") == funding_before
    api.put(f"/admin/facilities/{created['id']}", "chw1", updated, expect=403)
