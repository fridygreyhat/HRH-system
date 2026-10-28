# HRH Pay on Replit

## Run

Use the **Run** button (`Start application`), or `npm start` from the project root.
The workflow runs `python scripts/run_replit.py` directly, which starts Uvicorn
and the existing notification worker together. Monitoring Python directly avoids
an npm/shell wrapper leaving an old server behind during restarts. It stops both
processes when the workflow stops. `npm start` remains available for manual use.

- Preview: port **5000**, bound to `0.0.0.0`.
- Frontend: React/TypeScript compiled by Vite into `frontend/build`; Jest runs the existing tests.
- API: the existing FastAPI application, mounted at `/api`.
- API documentation: `/api/docs`.
- Database health: `/api/health`.
- PostgreSQL: the workspace's managed `DATABASE_URL`.
- Authentication: the project's existing password/JWT authentication.
- Signing secret: `SECRET_KEY`, or the existing `SESSION_SECRET` when unset.

The original backend/frontend directories, Docker setup and application stack
remain intact. The root npm configuration wraps the existing frontend workspace.
The frontend tooling requires Node 20.19+ or 22.12+, with TypeScript 5.9 and
compatible Node 20 typings. `npm run build` type-checks before building; `npm test
--workspace=hrh-frontend -- --runInBand` runs the frontend checks. The optional
frontend dev server uses port 3001 and proxies `/api` to local port 8001 (or
`DEV_API_PROXY_TARGET`). Published/managed preview operation remains on port 5000.
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

## Provider confirmation and regional pay periods

Provider SMS confirmation is removed by user request. CTC verification goes
directly to Technical Review for CHW, HCP and Data Clerk. Preserve historical
SMS audit records; do not represent a bypass as a provider confirmation.
Existing SMS-waiting logs must advance with a system audit, not get stranded.
Other notifications are not disabled by this request.

Technical Officers can create and manage pay periods only in their assigned
regions. Existing global schedules remain global and read-only for Technical;
Central Admin and FHI360 Finance retain global management. Regional periods
take precedence for new entry dates, including closed periods, so a global
open schedule cannot bypass a regional closure. Do not change a used period's
dates or regional ownership; historical financial records must remain intact.

## Data Clerk forms

Use the supplied Data Clerk roles document for roles 1–18: 18 numeric
indicators and four Yes/No checks. Both CARE_NEW and transferred-in
registrations, and separate HVL/EID requests and results, must be represented.
Daily Payroll and secondary-facility support use these fields; secondary
support also requires the facility name. Weekly eligible-list sharing and
HVL/EID result-sharing are available but optional on a daily entry.

The user repeated that Weekend Clinics must be the only initial Data Clerk
service. Do not show the daily data-entry groups under Services: the initial
clinic records work hours and mandatory location only. Daily data-entry
indicators belong under Payroll. Regional Technical can add scoped services
later. Do not invent rates or budgets. Remove daily evidence
and comment inputs, preserving older saved text and entry snapshots.
Data Clerk period-comment inputs are also removed. Do not erase previously
saved period comments when saving other header details.

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
- **Backdating restriction temporarily disabled at the user's request.**
  `backdate_restriction_enabled` defaults to false, so CHW, HCP and Data Clerk
  can enter missed older dates without a Technical Officer unlock. GPS, hour
  limits, period boundaries, closed periods and approval locks still apply.
  If re-enabled, new backdated entries have a **72-hour (three-day)** grace period measured from activity
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
  This reminder policy is separate from the temporarily disabled backdating limit.
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

- Budget projections and payment ceilings are separate. `estimated_amount` is
  nullable (unknown, not zero) and warns when committed + spent exposure reaches
  it; `allocated_amount` remains the enforceable hard cap. Historical estimates
  stay NULL. Exact-cap commitments are allowed, but any further amount is held.
  Moving committed funds to spent must never count them twice.
- The user approved **both Central Finance (FHI360 Finance) and the assigned CSO
  Finance team** managing CSO estimates and caps. This does not authorize Central
  Finance to pay CSO claims or bypass active CSO-region authority. RPM/oversight
  remain unable to edit estimates/caps. Changes require an audit reason; a cap
  cannot be below committed + spent or its estimate. Estimates themselves never
  block claim approval. Revise a projection before reallocating its cap below it.
- The existing budget module owns dual-track allocations; the singular
  `/budget/allocate` API is an alias, not a second source of budget balances.
  Tracker files may contain an optional estimate; old files without that column
  must preserve the current projection. There is still no live HQ tracker sync.
- The user approved a separate **direct community claim** exception:
  Provider draft/submission → assigned Community Verifier **or** scoped
  Technical Officer → independent assigned-CSO Finance approval → external
  payment reference and mandatory receipt → PAID → independent reconciliation.
  This path bypasses RPM and Regional Finance; ordinary Services/Payroll work
  must still follow their existing work-log approval and routing gates.
  A verifier cannot also approve the same claim, including on dual-role accounts.
  Providers cannot verify, approve, pay or reconcile their own claim.
- Direct community reporting uses explicitly configured active Route C,
  community-origin categories that do not require an HRH work log. Do not
  convert daily timesheet categories or fabricate payable rates or allocations.
  One live claim per provider, category and pay period prevents repeated
  submissions. Draft/returned totals are editable only by their provider; period,
  category and captured rates remain fixed. Returning a claim requires a reason
  and fresh verification on resubmission. Cancellation preserves its audit.
- Direct claims freeze approved rate components at creation, including caps,
  currency and the provider's cadre/region. Later rate retirement/revisions
  must not reprice drafts, corrections, approvals or payments. New pricing needs
  unambiguous approved rates covering the entire selected period; otherwise
  fail explicitly rather than guessing a mid-period rate. Regional CSO authority
  and the exact allocation are rechecked before commitment/payment.
- Community payments require proof even if the general proof setting is off.
  Ready v2 claims can upload proof without a legacy batch export. Payment proof
  alone does not mark a claim PAID; its full amount and reference must be recorded.
  Claims with recorded funds cannot be cancelled. Bank/mobile-money recipient
  details are returned only to the authorized, scoped payor.
- Regional Finance's Routing Dashboard includes RPM-approved liabilities still
  awaiting amount review, reviewed claims ready to channel, and budget holds.
  Stage labels do not permit channeling before finance review. Amounts come from
  the derived claim/captured snapshot, never a later rate revision.
- CSOs require explicit administrator-managed regional payment authority. An
  existing provider assignment or budget is not evidence of that authority:
  do not infer or auto-create CSO-region mappings during migration or seeding
  real accounts. Administrators configure active links in **CSO regions**;
  deactivating a link blocks future routing and budget operations, without
  deleting allocations, payments, claims, or audit history.
- The user confirmed that Services remain payable by **FHI360** and Payroll by
  the provider's **assigned CSO**. Regional mapping narrows CSO eligibility; it
  does not permit selecting a different regional CSO or paying Services via CSO.
- New CSO allocations and v2 payroll budget resolution use the exact
  **CSO × Region × Activity category × Pay period**. Never fall back to an
  all-region or another-region allocation. Historical global allocations and
  legacy workflows remain readable and unchanged. Missing configuration is an
  explicit error; insufficient configured funds produce `BUDGET_HOLD`.
  Currency totals must remain separate, with remaining = allocated − committed
  − spent. Duplicate regional category buckets are rejected rather than choosing
  an arbitrary funding line.
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
  Unpriced Services cannot pass RM approval. Payroll attendance can pass RM
  approval without a rate; no claim is created until a valid amount is available.
  Finance pricing, routing and payment guards remain required. Rate revisions
  do not silently reprice recorded work. Payroll has no daily indicator fields,
  allows at most eight weekday hours (40 Monday–Friday), and its hour totals
  are independent of Services, which may be recorded on the same date.
- Service payment setup uses **fixed amounts per service per day** only. When
  several services are recorded for one provider-date, pay the **highest fixed
  amount once**, never add the service amounts together. Preserve every service's
  indicators and immutable rate snapshot. Missing amounts or mixed currencies
  must block pricing, not silently discard a service. Guard overlapping/imported
  logs against a second live claim for the same provider-date.
  **Why:** the user confirmed the highest-amount daily rule.
  Payroll hourly-rate creation/revision is disabled; old rate definitions and
  existing financial snapshots stay read-only rather than being deleted.
- Only Super Admin may delete a pay period, and only if no work logs, claims
  or budget lines reference it. Audit the deletion and catch concurrent use.
  Used periods must be closed, never cascade-deleted.
  The explicitly requested October 2026 fresh start is a separate Super Admin
  action: clear active entries and return existing work logs to empty drafts,
  keeping October's budget, ledger, immutable audit records and pre-reset snapshots.
  Never disable append-only triggers or run this reset automatically at startup,
  migration or publish. It must be explicitly confirmed in the signed-in live
  app, with a fresh preview; claims or committed/spent funds block the action.
- RPM operational authority covers **every cadre within its assigned regions**,
  without needing cadre grants. Technical, Regional Finance and new channel-finance records enforce
  **Region × Cadre** scopes. Configure reviewer cadres and region scopes for
  these users; CSO Finance additionally requires the assigned CSO organization.
  Broad RPM authority must not widen a separate finance or technical role.
- Priced RPM approval automatically derives a `PENDING_FINANCE_REVIEW` claim, with
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

### Publishing precautions

- Publishing uses a Reserved VM with the existing API and notification worker.
  This keeps the hourly reminders running even when nobody visits the website;
  it incurs always-running compute rather than request-based autoscaling.
- The publishing build runs `npm ci && npm run build`, and startup uses
  `python scripts/run_replit.py`. Review the production database/schema in the
  Publishing tool; startup deliberately does not migrate or seed it.
- Keep credentials in Production app secrets, never browser build variables.
  Uploaded source documents, local uploads, agent memory and environment files
  are excluded from the published bundle. Secrets previously pasted into chat
  should be rotated before live use.
- Until durable proof storage is configured, publishing is suitable for testing,
  not storing real payment-proof uploads.

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
