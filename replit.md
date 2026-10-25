# HRH Pay on Replit

## Run

Use the **Run** button (`Start application`), or `npm start` from the project root.
The workflow runs `python scripts/run_replit.py` directly, which starts Uvicorn
and the existing notification worker together. Monitoring Python directly avoids
an npm/shell wrapper leaving an old server behind during restarts. It stops both
processes when the workflow stops. `npm start` remains available for manual use.

- Preview: port **5000**, bound to `0.0.0.0`.
- Frontend: the existing React/TypeScript CRA application, compiled into `frontend/build`.
- API: the existing FastAPI application, mounted at `/api`.
- API documentation: `/api/docs`.
- Database health: `/api/health`.
- PostgreSQL: the workspace's managed `DATABASE_URL`.
- Authentication: the project's existing password/JWT authentication.
- Signing secret: `SECRET_KEY`, or the existing `SESSION_SECRET` when unset.

The original backend/frontend directories, Docker setup and application stack
remain intact. The root npm configuration wraps the existing frontend workspace.
Python dependencies are installed through the root `pyproject.toml` / `uv.lock`;
the original Docker requirements files remain in `backend/`.

## Facility ownership/type

Facility ownership/type choices are **Public**, **Police** and **Prison**,
separate from funding sources (where payment money comes from). Keep existing
PNP and other legacy facility type values valid when editing records. Facility
ownership does not automatically select a funding source, payor or payment route.

## First sign-in

Username: **admin**. Use the initial password entered as the `ADMIN_PASSWORD`
Replit Secret. The app requires changing it at first sign-in.

The bootstrap adds the repository's base configuration and administrator only.
Additional accounts and configuration created later are not part of that seed.
Follow the README's first-time setup sequence to configure the organization and staff.

The bootstrap secret is only used to create the account. Changing it later does
not reset the password of an existing account.

## CHW daily timesheets and services

The user approved five colour-coded groups for the uploaded CHW daily sheet:
HIV testing/linkage (6), TB screening (2), appointment follow-up (3), HVL/DBS
follow-up (2), and HIV self-testing (1). All 14 indicators are filled together
on the daily PAYROLL timesheet. The uploaded copy had no coloured activity
groups; the user explicitly approved these five named groups instead.
The user selected a dropdown listing the five groups, revealing the selected
group's indicators rather than displaying all groups at once. Switching groups
must retain entered counts, and all 14 indicators remain required for saving.

CHW SERVICES initially includes Special and Weekend Clinics only, with
Expected Client Attendees and Clients attended and served. Regional Technical
Officers can add scoped service activities through the existing Rates setup.
No rates or budgets are invented. CHW evidence, daily-comment and period-comment
inputs are removed; older text and immutable entry snapshots remain intact.

## Data Clerk daily timesheets and services

Use the supplied Data Clerk roles document for roles 1–18: 18 numeric
indicators and four Yes/No checks. Both CARE_NEW and transferred-in
registrations, and separate HVL/EID requests and results, must be represented.
Daily Payroll and secondary-facility support use these fields; secondary
support also requires the facility name. Weekly eligible-list sharing and
HVL/EID result-sharing are available but optional on a daily entry.

The user requested Weekend Clinics as the only initial Data Clerk service;
it uses the same Data Clerk data-entry indicators. Regional Technical can add
scoped services later. Do not invent rates or budgets. Remove daily evidence
and comment inputs, preserving older saved text and entry snapshots.
Period comments are unchanged for Data Clerks.

## Provider location and Health Care Provider forms

All CHW, HCP and Data Clerk daily saves (including edits) require a newly
captured browser location with latitude, longitude and accuracy. Existing
coordinates do not enable Save when reopening a day. This requirement is
enforced by the API even if optional ENTRY capture settings are disabled.
Location is captured at data-entry time, including for backdated entries; it
must not be presented as proof of historical attendance. Existing geofence
review flags and coordinate visibility restrictions remain unchanged.

For new v2 HCP entries, Part A of the provider outreach sheet is SERVICES
(Index, SNS-RNR, TB contact tracing, special/weekend clinics, community TB active
case finding and quarterly inmate screening). Part B is the daily PAYROLL
timesheet (OPD, CTC ART initiation/refills and laboratory cascades). Each date
requires a selected cascade/service, its indicators and start/end times.
Evidence and comment inputs are removed for HCP only; previously recorded text
and immutable activity snapshots remain intact. Other cadres are unchanged.

The provider start form uses the labels **Services** and **Payroll**, with
distinct type-specific panels and a work date instead of a pay-period selector.
The date resolves to a configured open reporting period internally; no periods
are invented. Matching existing logs are continued rather than duplicated.
Overlapping schedules require administrator correction.

## Simulated workflow walkthrough status

The Demo walkthrough has been removed from the app navigation and page routing
at the user's request. Old `#demos` links fall back to the account's normal home
page. The underlying synthetic fixtures remain available for development tests.
These fixtures are an
immutable replay of actual API transitions executed against synthetic data in a
throwaway PostgreSQL test database, not a separate set of live financial records.
It includes all three cadres in both regions, Services and Payroll, return and
budget-hold examples, and the preserved legacy B/C workflows.

Generate its small runtime snapshot dataset with
`python scripts/generate_demo_walkthrough.py`. The generator creates and removes
its own test database. It must never target the application or production DB.
Mock SMS/OTP settings exist only in the test subprocess; the running app retains
its real gateway configuration. No credentials, OTPs, phones or bank accounts are
included in the snapshots. The downloadable sample proof is marked **NOT PROOF
OF A REAL PAYMENT**. Demo navigation does not impersonate live users or grant
permissions, and the demo API has no financial write endpoints.

Simulation verifies workflow rules, not Vodacom delivery, actual external
payments or durable storage of real proof files.

## Development commands

From the project root:

```sh
# Apply the repository's migrations to the DEVELOPMENT database.
python -m alembic -c backend/alembic.ini upgrade head

# Idempotent base configuration seed.
python -m backend.seed

# Frontend type checks and rebuild after frontend changes.
./node_modules/.bin/tsc --noEmit -p frontend
npm run build

# Serve the compiled frontend, API and notification worker.
npm start
```

After frontend changes, rebuild and restart the workflow. Restart after backend
changes as well. No Docker, nginx or separate browser-facing API origin is needed.
The same-origin `/api` URL is the frontend default.

`python scripts/check_replit.py` is a **one-time bootstrap smoke check** against
the development preview. It verifies login using `ADMIN_PASSWORD` without
printing credentials or tokens, and checks that a new account can reach password
change but cannot yet access the dashboard. Run it before changing the initial
password, not afterwards: the bootstrap secret will no longer be the login
password. Health and build checks do not require a login.

The backend acceptance-test harness creates/drops a throwaway database on the
configured PostgreSQL server. Set `HRH_TEST_DATABASE` to an unused test-only name
(the default remains `hrh_test`). Never run this harness against production or
select a database containing data you need. Fixture admin credentials are isolated
from the real bootstrap password.

## Imported activity and review requirements

- CHW, Data Clerk and HCP daily forms use activity-specific indicators from the
  uploaded activity sheets. Required indicators must be complete before submission;
  zero counts and explicit No checklist answers are valid.
- The imported daily-entry model is retained: one activity per provider/date within
  each work log. Secondary-facility data entry also records the supporting facility.
- The user confirmed **9 hours per weekday** and **45 hours total Monday–Friday**.
  **Saturday weekend clinics must total 4–6 hours** and are counted separately
  from the weekday limit. **Sunday work is not allowed.** This supersedes any older
  descriptions mentioning 8.5 hours/day or a Monday–Sunday 45-hour cap.
  Limits are summed across the provider's logs. The API serializes staff entry
  edits to prevent concurrent writes from bypassing those limits.
- New backdated entries have a **72-hour (three-day)** grace period measured from activity
  completion. Date-only CHW entries use the end of the local workday. Corrections
  to previously recorded dates remain available in editable/returned logs, with
  audit history, so the review-and-return workflow does not become impossible.
  This applies to CHW, HCP and Data Clerk. Technical Officers can grant an audited
  provider/date-specific unlock within their geographic and cadre scope, with a
  mandatory reason and expiry (24 hours by default; configurable per grant from
  1–168 hours), and revoke it. The unlock only bypasses the new-entry deadline:
  it does not reopen closed periods, permit Sundays, bypass hour limits, or
  change approval status. The system setting `backdate_grace_hours` controls
  the normal deadline.
- Reviewer reminders start **24 hours** after submission into a pending stage
  and repeat no more than once every **24 hours** while it remains unresolved.
  Each new review stage starts a new pending clock. The worker checks hourly.
  This reminder policy is separate from the 72-hour backdating limit.
- Reviewer summaries aggregate visible provider logs by calendar month, even for
  weekly pay periods. Daily and monthly cascade inversions appear as warnings.
  Review confirmation is required in the UI before reviewer actions at the bottom
  of the log. Returns and rejections continue to require comments.
- Claims exceeding their budget line enter `BUDGET_HOLD`; the relevant RPM receives
  a queued notification. Real SMS delivery still requires the separate gateway setup.
- Clinical activities are recorded as aggregate counts/checklists, not identifiable
  patient lists. CTC-2/CTC-3/LIS activities are tracked but no external clinical-system
  connection is configured.

## New-record financial workflow (v2.2)

- The user explicitly chose **new records only**. Existing work logs, their derived
  financial record families, rates, approvals and payment history remain on the
  legacy workflow. Do not migrate them into v2.2 or recalculate their amounts.
  New work logs always use v2.2; clients cannot request the legacy pipeline.
- New work logs have an immutable Services or Payroll type, with separate monthly
  review queues. RPM authorization is followed by Regional Finance amount review,
  then Services route to **FHI360** and Payroll route to the provider's **CSO**.
  New payroll does not use the old FHI360-to-CSO handoff.
- Technical Officers manage scoped activity definitions and immutable rate versions
  at `/rates`. Entry snapshots retain the rate and indicator definitions used.
  Per-unit cascade pricing requires an explicitly selected billable indicator;
  never infer that positives, linkage, or the final cascade field is payable.
  Unpriced work cannot pass RPM approval: preparing a priced liability and the
  operational approval are one transaction, with an explicit configuration error
  when pricing is missing. Rate revisions do not silently reprice recorded work.
- RPM operational authority covers **every cadre within its assigned regions**,
  without needing cadre grants. Technical, Regional Finance and new channel-finance records enforce
  **Region × Cadre** scopes. Configure reviewer cadres and region scopes for
  these users; CSO Finance additionally requires the assigned CSO organization.
  Broad RPM authority must not widen a separate finance or technical role.
- RPM approval automatically derives a `PENDING_FINANCE_REVIEW` claim, with
  recorded-rate amount and components, but no category, payor or committed budget.
  **Why:** operational approval records the liability; finance alone selects its
  financial configuration. Finance review fills in the category, payor and budget
  line on that same claim and moves it to `PENDING_ROUTING`, without committing
  budget. Historical reviewed v2 logs without a claim remain supported; no existing
  claims are backfilled.
  The Regional Finance Routing Queue shows the provider, captured cadre, assigned
  facility and region. Channeling requires an explicit eligible `target_payor_id`:
  the assigned CSO for Payroll or FHI360 for Services, never an arbitrary payor.
  The `/finance/pending-routing`, `/finance/payors`, `/finance/regions` and
  `/finance/channel` APIs enforce the same scope and approval controls as the UI.
  Every channel action records the actor, timestamp and chosen payor. Returning
  or rejecting an unreviewed/reviewed log cancels only its unpaid pending proposal,
  retaining snapshots and audit. Resubmission creates a fresh proposal on RPM approval.
- Routing makes the claim budget-committed and READY; it is not a bank transfer.
  Insufficient budget holds both the claim and log. Only a fully recorded actual
  payment, with required evidence, marks the log PAID.
- Reviewer controls remain below daily entries and monthly totals. The UI requires
  reaching the end and confirming the correct work type; the API independently
  requires that confirmation and enforces scope, stage and version checks.

## SMS and file storage

- SMS supports `SMS_GATEWAY_TYPE=vodacom`, `twilio`, or `mock`; unknown values
  fail explicitly rather than reporting mock success. Replit is configured for
  Vodacom with sender ID **Tanzania HRH** (provided by the user). Credentials are
  exclusively in `VODACOM_API_KEY` and `VODACOM_AUTH_TOKEN` Secrets; the sender is
  `VODACOM_SENDER_ID`. Development OTP exposure remains disabled.
- Vodacom's portal's published WASP guide specifies HTTPS
  `https://bulksms.vodacom.co.tz:9113/api/v1/wasp_sms_request`, JSON requests and
  `x-auth-key` / `x-auth-token` headers. The adapter uses these instructions, checks
  documented JSON/XML status 0 plus a nonempty MessageID, and never logs response
  bodies or credentials. Acceptance is not proof of handset delivery. A real
  delivery test is still required; automated tests use simulated responses only.
- On Replit, payment proofs are written to `.data/uploads`, which is excluded
  from Git. These local files are for workspace development, not durable
  published-app storage. Configure durable object storage before using real
  payment proofs in production.
- Schema migrations and seeding are intentionally not part of normal startup.
  For managed production PostgreSQL, use Replit's Publish schema flow rather
  than running development migrations on production.
