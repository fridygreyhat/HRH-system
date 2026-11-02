"""Prepare one owner-run, missing-only geography restore; never connect to a DB."""

import csv
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.prepare_production_admin import literal, write_private

SOURCE = ROOT / "backend/data/tz_locations.csv"


def locations(path=SOURCE):
    with path.open(encoding="utf-8") as source:
        rows = list(csv.DictReader(source))
    normalized = []
    seen = set()
    for row in rows:
        values = tuple((row.get(key) or "").strip() for key in ("region", "district", "ward"))
        if not all(values):
            raise ValueError("Every location requires a region, council/district and ward.")
        identity = tuple(value.lower() for value in values)
        if identity not in seen:
            seen.add(identity)
            normalized.append(dict(zip(("region", "district", "ward"), values)))
    if not normalized:
        raise ValueError("The location source is empty.")
    return normalized


def build_sql(rows):
    payload = json.dumps(rows, ensure_ascii=False)
    if "$geography_restore$" in payload:
        raise ValueError("Invalid restore delimiter in a location name.")
    return """-- ONE atomic statement. Add missing geography only.
-- Existing locations, facilities, accounts and work are never updated or deleted.
-- Source: the saved gazetteer described in backend/data/README.md; not current census boundaries.
DO $geography_restore$
DECLARE
    location jsonb;
    target_region integer;
    target_district integer;
    new_regions integer := 0;
    new_districts integer := 0;
    new_wards integer := 0;
BEGIN
    PERFORM set_config('lock_timeout', '8s', true);
    LOCK TABLE public.regions, public.districts, public.wards IN SHARE ROW EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM public.regions GROUP BY lower(name) HAVING count(*) > 1)
       OR EXISTS (SELECT 1 FROM public.districts GROUP BY region_id, lower(name) HAVING count(*) > 1)
       OR EXISTS (SELECT 1 FROM public.wards GROUP BY district_id, lower(name) HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'Restore refused: ambiguous existing location names. Resolve duplicates first; no data changed.';
    END IF;
    FOR location IN SELECT value FROM jsonb_array_elements(""" + literal(payload) + """::jsonb)
    LOOP
        SELECT id INTO target_region FROM public.regions
        WHERE lower(name) = lower(location->>'region');
        IF target_region IS NULL THEN
            INSERT INTO public.regions(name, created_at)
            VALUES (location->>'region', CURRENT_TIMESTAMP)
            RETURNING id INTO target_region;
            new_regions := new_regions + 1;
        END IF;
        SELECT id INTO target_district FROM public.districts
        WHERE region_id = target_region AND lower(name) = lower(location->>'district');
        IF target_district IS NULL THEN
            INSERT INTO public.districts(region_id, name, created_at)
            VALUES (target_region, location->>'district', CURRENT_TIMESTAMP)
            RETURNING id INTO target_district;
            new_districts := new_districts + 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.wards
                       WHERE district_id = target_district AND lower(name) = lower(location->>'ward')) THEN
            INSERT INTO public.wards(district_id, name, created_at)
            VALUES (target_district, location->>'ward', CURRENT_TIMESTAMP);
            new_wards := new_wards + 1;
        END IF;
    END LOOP;
    RAISE NOTICE 'Added % regions, % councils/districts and % wards. Existing records unchanged.',
        new_regions, new_districts, new_wards;
END;
$geography_restore$;
"""


def main():
    rows = locations()
    write_private(ROOT / ".data/production-geography-restore.sql", build_sql(rows))
    print("Prepared: .data/production-geography-restore.sql")
    print(f"Source: {len({r['region'] for r in rows})} regions, "
          f"{len({(r['region'], r['district']) for r in rows})} councils/districts, {len(rows)} wards.")
    print("No database was modified. Run manually in the intended Production SQL console with editing enabled.")


if __name__ == "__main__":
    main()
