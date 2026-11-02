import json

import pytest

from scripts.prepare_testing_restore import (
    foundation_sql, geography, load_live_snapshot, reconcile_live_facility,
    reconcile_live_user, recovery_document, user_foundation_sql,
    user_recovery_document,
)


def document():
    return {
        "version": 1, "warnings": [],
        "records": [
            {"id": "period", "kind": "pay_period", "label": "Old month",
             "data": {"region": "Iringa", "start_date": "2026-10-01",
                      "end_date": "2026-10-31", "status": "OPEN"}},
            {"id": "facility", "kind": "facility", "label": "Example facility",
             "data": {"name": "Example", "region": "Iringa", "district": "Iringa Urban",
                      "ward": "Kihesa"}},
        ],
    }


def test_recovery_excludes_old_periods_and_keeps_only_validated_setup():
    restored = recovery_document(document())
    assert [r.kind for r in restored.records] == ["facility"]
    assert len(document()["records"]) == 2
    assert any("inactive" in message for message in restored.warnings)


def test_foundation_uses_natural_geography_and_contains_no_operational_writes():
    restored = recovery_document(document())
    assert geography(restored) == (["Iringa"], [("Iringa", "Iringa Urban")],
                                  [("Iringa", "Iringa Urban", "Kihesa")])
    sql = foundation_sql(restored)
    assert sql.count("$testing_foundation$") == 2
    assert "DO $activity_restore$" not in sql
    assert "ON CONFLICT (cadre_id, key) DO NOTHING" in sql
    for table in ("users", "work_logs", "pay_periods", "claims", "activity_rates"):
        assert f"INSERT INTO public.{table}" not in sql
    assert "CREATE TABLE" not in sql and "ALTER TABLE" not in sql


def test_user_only_recovery_keeps_accounts_and_dependencies_not_old_periods():
    source = document()
    source["records"].append({
        "id": "reviewer", "kind": "user_setup", "label": "Example reviewer",
        "data": {
            "username": "example.reviewer", "full_name": "Example Reviewer",
            "phone": "+255700000001", "roles": ["SUPERVISOR"],
            "review_cadres": ["CHW"], "scopes": [{"region": "Iringa"}],
            "staff": None,
        },
    })
    result = user_recovery_document(source)
    assert [record.kind for record in result.records] == ["facility", "user_setup"]
    assert len(source["records"]) == 3
    assert any("inactive" in message for message in result.warnings)
    assert all(record.kind in {"user_setup", "organization", "facility"} for record in result.records)


def test_user_recovery_refuses_an_export_without_operational_users():
    with pytest.raises(ValueError, match="no recoverable operational users"):
        user_recovery_document(document())


def test_user_recovery_normalizes_valid_tanzania_local_phone_without_changing_source():
    source = document()
    source["records"].append({
        "id": "reviewer", "kind": "user_setup", "label": "Example reviewer",
        "data": {
            "username": "example.reviewer", "full_name": "Example Reviewer",
            "phone": "0758390922", "roles": ["SUPERVISOR"],
            "review_cadres": ["CHW"], "scopes": [{"region": "Iringa"}],
            "staff": None,
        },
    })
    result = user_recovery_document(source)
    recovered = next(r.data for r in result.records if r.kind == "user_setup")
    assert recovered["phone"] == "+255758390922"
    assert source["records"][-1]["data"]["phone"] == "0758390922"


def test_live_snapshot_parser_handles_csv_escaped_unicode_json_and_base64(tmp_path):
    import base64

    snapshot = {"facility": "Kihesa – Iringa"}
    payload = json.dumps(snapshot, ensure_ascii=False)
    direct = tmp_path / "direct.csv"
    import csv
    with direct.open("w", encoding="utf-8", newline="") as output:
        writer = csv.writer(output)
        writer.writerow(["snapshot"])
        writer.writerow([payload])
    encoded = tmp_path / "encoded.csv"
    encoded.write_text("payload\n" + base64.b64encode(payload.encode()).decode() + "\n", encoding="utf-8")
    assert load_live_snapshot(direct) == snapshot
    assert load_live_snapshot(encoded) == snapshot


def test_live_snapshot_resolves_facility_location_through_ward_and_district_ids(tmp_path):
    import csv

    snapshot = {
        "regions": [{"id": 1, "name": "Iringa"}],
        "districts": [{"id": 2, "region_id": 1, "name": "Iringa"}],
        "wards": [{"id": 3, "district_id": 2, "name": "Gangilonga"}],
        "facilities": [{"name": "Kihesa", "ward_id": 3, "facility_type": "PUBLIC"}],
    }
    path = tmp_path / "live.csv"
    with path.open("w", encoding="utf-8", newline="") as output:
        writer = csv.writer(output)
        writer.writerow(["snapshot"])
        writer.writerow([json.dumps(snapshot)])
    facility = load_live_snapshot(path)["facilities"][0]
    assert {key: facility[key] for key in ("region", "district", "ward")} == {
        "region": "Iringa", "district": "Iringa", "ward": "Gangilonga"
    }


def test_live_snapshot_reconstructs_role_and_staff_relationships(tmp_path):
    import csv

    snapshot = {
        "users": [{"id": 4, "username": "live.user", "full_name": "Example",
                   "phone": "+255700000001"}],
        "roles": [{"id": 8, "name": "SUPERVISOR"}],
        "user_roles": [{"user_id": 4, "role_id": 8}],
        "cadres": [{"id": 2, "code": "CHW"}],
        "user_review_cadres": [{"user_id": 4, "cadre_id": 2}],
        "staff": [{"user_id": 4}],
    }
    path = tmp_path / "relationships.csv"
    with path.open("w", encoding="utf-8", newline="") as output:
        writer = csv.writer(output)
        writer.writerow(["snapshot"])
        writer.writerow([json.dumps(snapshot)])
    user = load_live_snapshot(path)["users"][0]
    assert user["roles"] == ["SUPERVISOR"]
    assert user["review_cadres"] == ["CHW"]
    assert user["has_staff"] is True


def test_plain_user_foundation_is_missing_only_and_adds_only_required_geography_and_sections():
    source = document()
    source["records"].append({
        "id": "provider", "kind": "user_setup", "label": "Example provider",
        "data": {
            "username": "example.provider", "full_name": "Example Provider",
            "phone": "+255700000001", "roles": ["PROVIDER"],
            "review_cadres": [], "scopes": [{"region": "Iringa"}],
            "staff": {
                "first_name": "Example", "middle_name": None, "last_name": "Provider",
                "occupation": "CHW", "occupation_other": None,
                "employment_start_date": "2024-01-01", "employment_end_date": None,
                "cadre": "CHW", "assignments": [{
                    "region": "Iringa", "district": "Iringa Urban", "ward": "Kihesa",
                    "facility": {"name": "Example", "ward": "Kihesa",
                                 "district": "Iringa Urban", "region": "Iringa"},
                    "organization": None, "section": "CTC",
                    "start_date": "2024-01-01", "end_date": None, "is_primary": True,
                }],
            },
        },
    })
    result = user_recovery_document(source)
    sql = user_foundation_sql(result)
    assert sql.count("INSERT INTO") == 4
    assert "public.districts" in sql and "public.wards" in sql and "public.sections" in sql
    for table in ("users", "staff", "work_logs", "pay_periods", "payment_claims"):
        assert f"INSERT INTO public.{table}" not in sql
    assert "DO $" not in sql and "CREATE TABLE" not in sql


def test_approved_live_identity_match_preserves_phone_and_existing_roles():
    source = document()
    source["records"].append({
        "id": "saved-user", "kind": "user_setup", "label": "Irene",
        "data": {
            "username": "irene.old", "full_name": "Irene Mauya",
            "phone": "+255700000001", "roles": ["TECHNICAL_OFFICER"],
            "review_cadres": ["HCP"], "scopes": [{"region": "Iringa"}],
            "staff": None,
        },
    })
    result = user_recovery_document(source)
    reconcile_live_user(result, "irene.old", {
        "username": "i.mauya", "full_name": "Irene Mauya", "phone": "+255700000002",
        "roles": ["SUPERVISOR"], "review_cadres": ["CHW"], "has_staff": False,
    })
    user = next(row.data for row in result.records if row.kind == "user_setup")
    assert user["username"] == "i.mauya" and user["phone"] == "+255700000002"
    assert user["full_name"] == "Irene Mauya"
    assert user["roles"] == ["SUPERVISOR", "TECHNICAL_OFFICER"]
    assert user["review_cadres"] == ["CHW", "HCP"]

    unmodified = user_recovery_document(source)
    with pytest.raises(ValueError, match="full names differ"):
        reconcile_live_user(unmodified, "irene.old", {
            "username": "different.account", "full_name": "Someone Else",
            "phone": "+255700000003", "roles": [], "has_staff": False,
        })


def test_approved_live_facility_match_updates_facility_and_nested_assignments():
    source = document()
    source["records"][1]["label"] = "Kihesa"
    source["records"][1]["data"].update({
        "name": "kihesa", "region": "Iringa", "district": "Iringa Urban",
        "ward": "Kihesa",
    })
    source["records"].append({
        "id": "provider", "kind": "user_setup", "label": "Example provider",
        "data": {
            "username": "example.provider", "full_name": "Example Provider",
            "phone": "+255700000001", "roles": ["PROVIDER"],
            "review_cadres": [], "scopes": [{"facility": {
                "name": "kihesa", "region": "Iringa", "district": "Iringa Urban", "ward": "Kihesa"
            }}],
            "staff": {
                "first_name": "Example", "middle_name": None, "last_name": "Provider",
                "occupation": "CHW", "occupation_other": None,
                "employment_start_date": "2024-01-01", "employment_end_date": None,
                "cadre": "CHW", "assignments": [{
                    "region": "Iringa", "district": "Iringa Urban", "ward": "Kihesa",
                    "facility": {"name": "kihesa", "ward": "Kihesa",
                                 "district": "Iringa Urban", "region": "Iringa"},
                    "organization": None, "section": "CTC",
                    "start_date": "2024-01-01", "end_date": None, "is_primary": True,
                }],
            },
        },
    })
    result = user_recovery_document(source)
    reconcile_live_facility(result, "kihesa", {
        "name": "Kihesa", "region": "Iringa", "district": "Iringa",
        "ward": "Gangilonga", "facility_type": "PUBLIC",
        "geofence_lat": None, "geofence_lon": None, "geofence_radius_meters": None,
    })
    facility = next(row.data for row in result.records if row.kind == "facility")
    assignment = next(
        row.data["staff"]["assignments"][0]
        for row in result.records if row.kind == "user_setup"
    )
    assert (facility["name"], facility["district"], facility["ward"]) == ("Kihesa", "Iringa", "Gangilonga")
    assert (assignment["district"], assignment["ward"], assignment["facility"]["name"],
            assignment["facility"]["district"], assignment["facility"]["ward"]) == (
        "Iringa", "Gangilonga", "Kihesa", "Iringa", "Gangilonga"
    )
    assert facility["facility_type"] == "PUBLIC"
