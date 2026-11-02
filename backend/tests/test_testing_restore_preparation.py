import pytest

from scripts.prepare_testing_restore import foundation_sql, geography, recovery_document, user_recovery_document


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
