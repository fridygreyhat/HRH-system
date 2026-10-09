"""Enrolling a health worker from the Users screen creates and links the staff record."""
from datetime import date


def _new_staff(api, phone: str) -> dict:
    regions = api.get("/admin/regions", "admin")
    cadre = next(c for c in api.get("/admin/cadres", "admin") if c["code"] == "CHW")
    return {
        "cadre_id": cadre["id"], "first_name": "Neema", "last_name": "Mushi", "verified_phone": phone,
        "employment_start_date": date.today().isoformat(), "assignment": {"region_id": regions[0]["id"]},
    }


def test_create_health_worker_user_creates_linked_staff(api):
    phone = "+255700111222"
    user = api.post("/admin/users", "admin", {
        "username": "neema.chw", "password": "Temp-pass-1", "full_name": "Neema Mushi", "phone": phone,
        "roles": ["PROVIDER"], "staff": _new_staff(api, phone),
    }, expect=201)
    assert user["staff_id"] and "PROVIDER" in user["roles"]
    assert all(s["id"] != user["staff_id"] for s in api.get("/admin/unlinked-staff", "admin"))


def test_provider_role_needs_a_staff_record(api):
    api.post("/admin/users", "admin", {
        "username": "orphan.provider", "password": "Temp-pass-1", "full_name": "No Record", "phone": "+255700111333", "roles": ["PROVIDER"],
    }, expect=422)


def test_link_existing_user_to_new_staff_record(api):
    phone = "+255700111444"
    user = api.post("/admin/users", "admin", {
        "username": "late.link", "password": "Temp-pass-1", "full_name": "Late Link", "phone": phone, "roles": ["OVERSIGHT"],
    }, expect=201)
    assert user["staff_id"] is None
    linked = api.post(f"/admin/users/{user['id']}/staff", "admin", {"staff": _new_staff(api, phone)})
    assert linked["staff_id"] and set(linked["roles"]) == {"OVERSIGHT", "PROVIDER"}
    api.post(f"/admin/users/{user['id']}/staff", "admin", {"staff": _new_staff(api, "+255700111555")}, expect=409)


def test_gazetteer_and_typed_facility_name(api):
    regions = {r["name"]: r for r in api.get("/admin/regions", "admin")}
    assert len(regions) >= 31 and {"Dar es Salaam", "Kaskazini Pemba", "Songwe"} <= set(regions)
    dar = regions["Dar es Salaam"]["id"]
    district = next(d for d in api.get("/admin/districts", "admin") if d["region_id"] == dar and d["name"] == "Ubungo")
    ward = next(w for w in api.get("/admin/wards", "admin") if w["district_id"] == district["id"] and w["name"] == "Mbezi")
    body = _new_staff(api, "+255700111666")
    body["assignment"] = {"region_id": dar, "district_id": district["id"], "ward_id": ward["id"], "facility_name": "Mbezi  Health Centre"}
    first = api.post("/staff", "central1", body, expect=201)
    body2 = {**body, "verified_phone": "+255700111777", "assignment": {**body["assignment"], "facility_name": "mbezi health centre"}}
    second = api.post("/staff", "central1", body2, expect=201)
    assert first["current_assignment"]["facility"] == "Mbezi Health Centre"
    assert first["current_assignment"]["facility_id"] == second["current_assignment"]["facility_id"]
    body3 = {**body, "verified_phone": "+255700111888", "assignment": {"region_id": dar, "facility_name": "Nowhere Dispensary"}}
    api.post("/staff", "central1", body3, expect=422)
