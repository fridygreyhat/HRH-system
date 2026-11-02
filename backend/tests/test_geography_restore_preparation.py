import pytest

from scripts.prepare_geography_restore import build_sql, locations


def test_saved_geography_and_restore_scope():
    rows = locations()
    assert len({row["region"] for row in rows}) == 31
    assert len({(row["region"], row["district"]) for row in rows}) == 172
    assert len(rows) == 3644
    sql = build_sql(rows)
    assert sql.count("$geography_restore$") == 2
    assert "LOCK TABLE public.regions, public.districts, public.wards" in sql
    assert "CREATE TABLE" not in sql and "ALTER TABLE" not in sql
    assert "\n    UPDATE " not in sql and "\n    DELETE " not in sql
    for table in ("users", "staff", "facilities", "pay_periods", "work_logs", "claims"):
        assert f"INSERT INTO public.{table}" not in sql


def test_source_rejects_missing_parent_and_deduplicates_names(tmp_path):
    path = tmp_path / "locations.csv"
    path.write_text("region,district,ward\nRegion,Council,Ward\nregion,council,ward\n")
    assert len(locations(path)) == 1
    path.write_text("region,district,ward\nRegion,,Ward\n")
    with pytest.raises(ValueError, match="requires"):
        locations(path)


def test_names_are_escaped_and_block_delimiters_rejected():
    sql = build_sql([{"region": "R", "district": "D", "ward": "Ng'ombe"}])
    assert "Ng''ombe" in sql
    with pytest.raises(ValueError, match="delimiter"):
        build_sql([{"region": "$geography_restore$"}])
