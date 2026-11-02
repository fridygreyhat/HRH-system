"""Prepare missing-only activity configuration SQL; never connect to a database.

Run manually, then apply the generated single statement in the target SQL console.
No startup hooks, schema changes, accounts, rates, work records or demo data.
"""

import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.seed import CADRES
from backend.services.activities import FIELD_SPECS
from scripts.prepare_production_admin import literal, write_private


def configuration():
    """Use the same maintained definitions as the application's base setup."""
    result = []
    for spec in CADRES:
        fields = {}
        for order, (key, english, swahili, *kind) in enumerate(
            [*spec["fields"], *FIELD_SPECS[spec["code"]]]
        ):
            fields[key] = {
                "key": key, "label_en": english, "label_sw": swahili,
                "field_type": kind[0] if kind else "INTEGER", "sort_order": order,
            }
        result.append({
            **{key: value for key, value in spec.items() if key != "fields"},
            "fields": list(fields.values()),
        })
    return result


def build_sql():
    payload = json.dumps(configuration(), ensure_ascii=False)
    assert "$activity_restore$" not in payload
    return """-- Restore missing CHW, HCP and Data Clerk activity/indicator configuration.
-- ONE atomic statement. Existing setup, accounts and work are never overwritten.
-- No rates, payments, periods or demo records are created.
DO $activity_restore$
DECLARE
    spec jsonb;
    indicator jsonb;
    target_cadre integer;
    added_cadres integer := 0;
    added_fields integer := 0;
    affected integer;
BEGIN
    PERFORM set_config('lock_timeout', '8s', true);
    LOCK TABLE public.cadres, public.cadre_form_fields IN SHARE ROW EXCLUSIVE MODE;
    FOR spec IN SELECT value FROM jsonb_array_elements(""" + literal(payload) + """::jsonb)
    LOOP
        INSERT INTO public.cadres
            (code, name, form_title, hours_mode, uses_facility_geofence,
             requires_facility_endorsement, technical_reviewer_title,
             occupation_options, uses_section, is_active)
        VALUES
            (spec->>'code', spec->>'name', spec->>'form_title', spec->>'hours_mode',
             (spec->>'uses_facility_geofence')::boolean,
             (spec->>'requires_facility_endorsement')::boolean,
             spec->>'technical_reviewer_title', spec->'occupation_options',
             (spec->>'uses_section')::boolean, TRUE)
        ON CONFLICT (code) DO NOTHING;
        GET DIAGNOSTICS affected = ROW_COUNT;
        added_cadres := added_cadres + affected;
        SELECT id INTO STRICT target_cadre FROM public.cadres WHERE code = spec->>'code';
        FOR indicator IN SELECT value FROM jsonb_array_elements(spec->'fields')
        LOOP
            INSERT INTO public.cadre_form_fields
                (cadre_id, key, label_en, label_sw, field_type, sort_order, is_active)
            VALUES
                (target_cadre, indicator->>'key', indicator->>'label_en',
                 indicator->>'label_sw', indicator->>'field_type',
                 (indicator->>'sort_order')::integer, TRUE)
            ON CONFLICT (cadre_id, key) DO NOTHING;
            GET DIAGNOSTICS affected = ROW_COUNT;
            added_fields := added_fields + affected;
        END LOOP;
    END LOOP;
    RAISE NOTICE 'Restored % missing cadres and % missing indicator definitions. Existing data unchanged.',
        added_cadres, added_fields;
END;
$activity_restore$;
"""


def main():
    destination = ROOT / ".data" / "activity-configuration-restore.sql"
    write_private(destination, build_sql())
    rows = configuration()
    print("Prepared: .data/activity-configuration-restore.sql")
    print(f"Contains {len(rows)} cadre templates and {sum(len(row['fields']) for row in rows)} indicator definitions.")
    print("No database was modified. Apply manually in the Production SQL console.")


if __name__ == "__main__":
    main()
