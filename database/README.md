# Reference data for a new deployment

This folder holds reusable configuration, not a database backup. It is included
in version control and in the published project. It contains no users, passwords,
staff placements, pay periods, timesheets, approvals, claims or payments.

## Cadres and indicator forms

`cadre-forms.sql` is one complete, atomic PostgreSQL statement containing:

| Cadre | Indicator definitions |
| --- | ---: |
| CHW | 26 |
| Data Clerk | 28 |
| HCP | 50 |

It supplies the missing standard cadre metadata and the English/Swahili field
definitions used by Payroll timesheets and Services. Activity groupings and
service choices are maintained by the application's activity catalogs, which
are published with the backend code.

### Apply to Live

1. Publish the application and review any schema changes in Replit's Publish UI.
   The target database must already have the application's tables.
2. Confirm the selected database belongs to the intended Live site.
3. Open `database/cadre-forms.sql`, copy the **entire file**, and run it as one
   statement in that database's SQL console with editing enabled.
4. Check the returned `fields_after_restore` totals against the table above.
   Existing additional custom fields can make a total larger.
5. Refresh the published app. Check Cadre Forms and Register new staff.

The statement can be rerun: it only inserts missing records, uses the target's
actual cadre IDs, and preserves existing labels, settings and inactive flags.
Review intentional changes to existing configuration through the normal admin
screens; this restore does not overwrite them.

**Publishing code alone does not import reference data into an existing Live
database.** This is an explicit owner-run data import, not an automatic startup
seed, deployment hook or schema migration. It does not grant database access,
create accounts or configure service payment amounts.

## Tanzania regions, councils and wards

The version-controlled location source is `backend/data/tz_locations.csv`.
Keep it with the project when moving or deploying it. It contains the saved
snapshot of 31 regions, 172 councils/districts and 3,644 wards; see
`backend/data/README.md` for its age and coverage limitations.

To prepare the existing missing-only geography import:

```bash
python scripts/prepare_geography_restore.py
```

Review `.data/production-geography-restore.sql` and apply it manually to the
intended database. That generated file is intentionally ignored by Git; the
CSV and preparation script are the durable sources. The import preserves
existing location IDs and facility links and refuses ambiguous duplicates.
It is separate from the cadre import and does not run when the app starts.

## Maintain the saved form statement

The maintained definitions come from `backend/seed.py` and
`backend/services/activities.py`. After changing them, regenerate the SQL:

```bash
python scripts/prepare_activity_restore.py --print-reference > database/cadre-forms.sql
python -m pytest backend/tests/test_activity_restore_preparation.py -q
```

Review the resulting SQL diff and include the updated file with the code change.
The test checks that this saved statement matches the maintained definitions.
Preparation and tests do not modify Preview or Live data.
