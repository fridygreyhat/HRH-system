"""Activity recovery must remain explicit, missing-only, and free of demo data."""

from scripts.prepare_activity_restore import build_plain_sqls, build_sql, configuration


def test_configuration_includes_all_current_cadre_fields():
    from backend.services.chw_forms import CHW_GROUPS, CHW_TB_CONTACT_FIELDS
    from backend.services.data_clerk_forms import data_clerk_builtins
    from backend.services.activities import ACTIVITIES

    rows = {row["code"]: row for row in configuration()}
    assert set(rows) == {"CHW", "HCP", "DATA_CLERK"}
    for row in rows.values():
        keys = [field["key"] for field in row["fields"]]
        assert len(keys) == len(set(keys))
    chw_keys = {field["key"] for field in rows["CHW"]["fields"]}
    assert {key for group in CHW_GROUPS for key in group["fields"]} <= chw_keys
    assert {field[0] for field in CHW_TB_CONTACT_FIELDS} <= chw_keys
    clerk_fields = {field["key"]: field for field in rows["DATA_CLERK"]["fields"]}
    assert data_clerk_builtins(clerk_fields, 1)
    hcp_keys = {field["key"] for field in rows["HCP"]["fields"]}
    assert {key for item in ACTIVITIES["HCP"] for key in item["fields"]} <= hcp_keys


def test_restore_is_atomic_missing_only_and_has_no_operational_data():
    sql = build_sql()
    executable = "\n".join(line for line in sql.splitlines() if not line.startswith("--")).strip()
    assert executable.startswith("DO $activity_restore$")
    assert executable.endswith("$activity_restore$;")
    assert sql.count("$activity_restore$") == 2
    assert "ON CONFLICT (code) DO NOTHING" in sql
    assert "ON CONFLICT (cadre_id, key) DO NOTHING" in sql
    assert "UPDATE " not in sql and "DELETE " not in sql
    assert "CREATE TABLE" not in sql and "ALTER TABLE" not in sql
    for table in ("users", "activity_rates", "work_logs", "pay_periods", "claims", "staff"):
        assert f"INSERT INTO public.{table}" not in sql


def test_plain_console_alternative_uses_two_missing_only_insert_statements():
    cadres, fields = build_plain_sqls()
    assert cadres.startswith("INSERT INTO public.cadres")
    assert "ON CONFLICT (code) DO NOTHING" in cadres
    assert "INSERT INTO public.cadre_form_fields" in fields
    assert "ON CONFLICT (cadre_id, key) DO NOTHING" in fields
    assert "JOIN public.cadres c ON c.code = f.cadre_code" in fields
    for sql in (cadres, fields):
        assert "DO $" not in sql and "BEGIN;" not in sql and "COMMIT;" not in sql
        assert "RETURNING" in sql
        for table in ("users", "activity_rates", "work_logs", "pay_periods", "claims", "staff"):
            assert f"INSERT INTO public.{table}" not in sql
