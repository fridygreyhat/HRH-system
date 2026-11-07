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
- API documentation: `/api/docs`, only when `ENABLE_API_DOCS=true`.
- Database health: `/api/health`.
- PostgreSQL: the workspace's managed `DATABASE_URL`.
- Authentication: the project's existing password/JWT authentication.
- Signing secret: `SECRET_KEY`, or the existing `SESSION_SECRET` when unset. At least 32 characters; the server refuses to start otherwise.
- Staff payment-critical fields: every change, including an administrator's, is a change request decided by a different in-region HRH administrator.

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

For an explicitly approved **empty** Production database, run
`python scripts/prepare_production_admin.py` to prepare private admin-only SQL
at `.data/production-admin-setup.sql`. This command does not connect to a
database. The entire generated file is one atomic PostgreSQL `DO` statement,
which must be applied manually in the Production SQL console. It creates
system role definitions and `admin`, refuses to
overwrite any existing account, and adds no business setup or demo records.
Keep the generated file private and delete it after successful verification;
it contains a password hash and is excluded from Git and publishing.

### Account recovery

Super Admin can use Administration → Users to reset an individual password,
review failed sign-in reasons, or explicitly reset all non-Super-Admin accounts.
Bulk recovery excludes every account granted SUPER_ADMIN, clears lockouts,
revokes previous sessions and requires each affected user to choose a new
password. Deactivated accounts stay deactivated; passwords are never included
in audit records. The confirmation shows the environment hostname and total
account count, independent of table filters.

**Why:** The user requested recovery for failed sign-ins while keeping all
Super Admin accounts unchanged. Live resets must be deliberately run by an
authenticated Super Admin on the published app, never during startup or deploy.

## CHW daily timesheets and services

The user approved five colour-coded groups for the uploaded CHW daily sheet:
HIV testing/linkage (6), TB screening (2), appointment follow-up (3), HVL/DBS
follow-up (2), and HIV self-testing (1). All 14 indicators are filled together
on the daily PAYROLL timesheet. The uploaded copy had no coloured activity
groups; the user explicitly approved these five named groups instead.
The user selected a dropdown listing the five groups, revealing the selected
group's indicators rather than displaying all groups at once. Switching groups
must retain entered counts, and all 14 indicators remain required for saving.

CHW SERVICES includes Special and Weekend Clinics, with Expected Client
Attendees and Clients attended and served, plus TB Contact tracing with five
required whole-number counts: contacts listed, contacts reached and screened,
presumptive contacts, samples collected and transported, and TB cases diagnosed
and started/referred for treatment. Regional Technical
Officers can add scoped service activities through the existing Rates setup.
No rates or budgets are invented. CHW evidence, daily-comment and period-comment
inputs are removed; older text and immutable entry snapshots remain intact.

**Why:** The user requested TB Contact tracing as a separate CHW Service, not
as extra Payroll indicators. Its definitions are supplied by the versioned
catalog even on installations without the new seed fields, so publishing this
service does not require startup migrations or rewriting saved entries.

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
open schedule cannot bypass a regional closure. Regional ownership cannot be changed.
Dates may be corrected for unused or draft-only periods, but every saved workday
must remain within the new range. Submitted records, payment claims and budget
lines lock dates; labels and open/closed status remain editable. Show the actual
conflict reason, including overlaps, rather than a generic “already in use” message.

**Why:** The user requested post-creation period editing and staff start-date
correction without losing existing work or financial history.

HRH administrators can correct staff employment start dates through Staff registry
→ staff member → Edit start date. Correcting the initial placement is a separate,
explicit option; never silently backdate placements or alter later rotations.
Do not exclude recorded workdays, change submitted placement dates, or bypass
regional authority. These corrections require a reason and an administrator audit.

Provider facility changes are separate from identity/payment edits. HRH admins
can open the staff record from Administration → Users or Staff registry, then
use Change facility / placement. A correction on the original placement start
date is allowed only when no work log references it; otherwise use an effective-
dated transfer and retain the old placement and work-log assignment references.
Central/Super Admin can rename a shared facility with an explicit reason and
warning that it affects all linked staff. Renaming must not overwrite its other
configuration or move individual providers.

**Why:** The user reported being unable to edit provider placements or facilities.
Existing work and payment history must not be silently reassigned.

Print view uses bounded, retryable authenticated loading and one selected calendar
month per table, with totals for that month rather than the full reporting period.
Do not disable authentication or restore non-admin audit access to make printing work.

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

**Current Payroll policy:** Payroll now ends at RM work approval and is reported
as monthly indicator/hour totals, without finance approval, pricing or budget
requirements. Payroll payment-routing descriptions in this historical section
apply only to retained financial history; see “Operational approval versus
payment pricing” below for the current policy. Services remains payable.

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
- Direct claims freeze configured rate components at creation, including caps,
  currency and the provider's cadre/region. Later rate retirement/revisions
  must not reprice drafts, corrections, approvals or payments. New pricing needs
  unambiguous active rates covering the entire selected period; otherwise
  fail explicitly rather than guessing a mid-period rate. Regional CSO authority
  and the exact allocation are rechecked before commitment/payment.

### Rate-rule maintenance

Finance rate rules are active on save, without proposal, approval or rejection
steps. Existing pending rate rules are also usable under this policy. FHI360
Finance, CSO Finance and Super Admin retain create/edit/delete access; RM and
Oversight retain read access. Work-log, claim and payment approvals are unchanged.
Unused rates may be permanently deleted. Used rates are retired on deletion;
editing a used rate creates an active replacement while preserving the original
source and all existing claim amounts.

**Why:** The user requested removal of confusing pending rate approvals while
keeping rates editable and deletable, without rewriting financial history.
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
  do not silently reprice recorded work. CHW Payroll restores the five daily
  activity groups and all 14 reporting counts, including editable older
  attendance-only entries. HCP daily OPD, CTC ART and laboratory cascades and
  Data Clerk daily activity groups are also restored, with monthly-entry guidance.
  Preserve saved financial terms when restoring editable reporting fields.
  **Why:** the user asked to recover activities for all three provider cadres.
  Payroll allows at most eight weekday hours (40 Monday–Friday), and its hour totals
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
  The October 2026 work-record clearing feature has been removed from both
  the UI and API. Do not reintroduce a special reset or clear existing records.
  **Why:** the user explicitly requested removing “Clear October 2026 work records.”
- Audit trails are visible only to Super Admin, System Admin and Central Admin.
  Enforce this in APIs as well as UI; do not delete audit records. Operational
  reviewers and providers still receive current status and the latest correction
  note/flags, not the complete audit history.
  **Why:** the user requested removing audit-trail access from CTC, Technical and Finance.
- Services and Payroll remain separate review lists and separately confirmed
  approval actions for CTC, Technical and RM. Regional Finance receives
  RM-authorized records, reviews their amounts/budgets, then routes Services
  to FHI360 and Payroll to the assigned CSO. Do not describe an authorized or
  routed record as paid. Missing pricing or Region × Cadre assignments must
  remain explicit blockers; do not grant broad finance access to hide them.
  **Why:** the user requested confirmation of the separate approval paths and
  an explanation of Regional, CSO and Central Finance views. “Central Finance”
  means FHI360 Finance here, not the Central Admin configuration role.
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

### Pay-period date safeguards
- Reporting periods use years 2000–2100 and at most 366 inclusive calendar days.
  Apply the same limits to API creation/editing and frontend calendar expansion.
- Existing corrupt periods must render a clear warning and only actual recorded
  months, not an unbounded list of empty months. Block submission/approval until
  dates are corrected; retain normal scope and approval checks.
- **Why:** a mistyped four-digit year caused review pages to expand centuries of
  empty months and made approval controls unusable. An audited data correction
  should preserve period/work-log IDs, actual entries and financial history;
  do not delete work or weaken the normal used-period date locks to repair it.

### Programme funding setup
- Services funding choices are **PnP**, **Supply Chain**, and **EpiC**. Existing sources and historical references are retained.
- Regional Finance selects a funding source only; there is no user-facing budget category requirement. An internal programme-specific claim identity is derived without creating or assigning any allocation.
- Uncommitted Services reviews can be corrected without repeating provider/CTC/technical/RM work approval. Routing checks the saved funding identity, payment organization and current review token; changes require fresh Finance review.
- Payroll remains report-only; programme/category selection, pricing, budgets and payment routing do not apply to new Payroll reports. Paid and committed historical claims remain protected.

### Current payment policy: monthly regional Services budgets
- Regional Finance uploads a budget document and enters its total for each region, calendar month and currency in the Budget tab. PDF, XLSX or UTF-8 CSV attachments are supporting documentation, not automatic amount imports. Central Finance has scoped read/download access; only Regional Finance or Super Admin may upload or revise totals.
- The Budget tab shows what reduced each budget: provider, claim, services, amount and whether it was restored. Amounts are always listed so they add up to the total; provider and service details need the claim's cadre scope.
- Deduct the payable Services amount immediately when Regional Finance submits to the named Central Finance reviewer. Do not wait for payment and do not deduct again when a payment or proof is recorded. Missing/insufficient budgets block the entire submission atomically. Dates worked determine the calendar-month breakdown, not a pay-period label.
- Multiple services on the same provider-date pay only the highest configured daily amount, once. Keep amounts frozen in the claim; monthly ceilings do not replace fixed daily pricing. Payroll remains report-only and has no regional budget deduction.
- Use locked, refreshed budget balances, stable lock ordering and unique claim/month deductions. An unpaid cancellation restores its deductions once; recorded payments prevent restoration. A revised total cannot fall below current deductions. Keep audit records and claim-linked deduction history.
- Existing routed/paid claims are not retroactively charged. Enforce monthly budgets on new submissions, including pending reviews prepared before the budget feature was restored. Preserve historical fixed amounts, ledger entries and paid statuses.
- **Why:** the user explicitly restored monthly regional Services budgets and chose “Deduct immediately on submission,” superseding the earlier request to remove budgets.
- Services route: provider → facility CTC → Technical → RM → Regional Finance review and explicit FHI360/named reviewer selection with monthly deduction → Central Finance approval → payment recording/proof → paid confirmation and reconciliation. Preserve region/cadre/facility access boundaries.
- Separate direct community claims retain provider → community verifier → independent assigned CSO Finance → payment/proof, using their approved captured rates without a new regional budget requirement.
- Preserve legacy allocations, paid snapshots and committed financial ledger history. Historical payment/cancellation bookkeeping may still update an existing committed line; new monthly regional deductions use their own ledger, not legacy category/pay-period allocations.
- Older budget/routing descriptions below are historical wherever they conflict with this policy.

### Monthly regional report sign-off
- Regional Finance reviews and signs off each region, calendar month and work type after RM authorization, covering all CHW, HCP and Data Clerk work in its assigned region. A Regional Finance user must hold all three cadre review scopes to sign off a whole-region report.
- This is append-only documentation approval, not a claim, pricing, Payroll financial authorization, or payment instruction. Late work changes make the Regional Finance live view stale; a fresh review creates a new revision without changing old signed documents.
- Central Finance access to new individual work logs starts at RM authorization, within its assigned region and cadre scopes. Finance alone must not expose drafts or returned/rejected work. A separate operational reviewer role retains its own scoped access.
- Assigned CSO Finance users see only the latest signed report data belonging to their CSO, region and cadre scopes. Unapproved work must not leak through older report URLs or file exports. PDF and CSV reflect the same authorized view and include totals, indicators, provider breakdown and approval attribution.
- A published report naming a user's assigned CSO grants read-only visibility of that CSO's report region even when CSO payment routing has not been configured. Explicit user region limits and cadre grants still apply. Never create payment authority just to make an approved report visible.
- **Why:** the user needs the whole monthly regional report reviewed before their CSO Finance team can document it, while keeping Payroll report-only and payment routing separate.

### Pay month and public holidays
- A **pay month runs from the 26th to the 25th** and takes the name of the month it ends in: 26 Oct to 25 Nov is November. `backend/core/period_dates.py` and `frontend/src/format.ts` define it, and every month in the system follows it: monthly reports and sign-offs, Services reports, Services budgets and deductions, reviewer totals, printed timesheets and CSO salary files. A timesheet therefore stays in one month, so a salary cannot appear in two files. This replaces the earlier calendar-month wording elsewhere in this file.
- A provider's first submission opens on the last day of the period, the 25th. Later submission stays allowed, and returned or rejected work can come back at any time.
- The global pay month opens by itself when anyone opens the pay-period list on or after the 26th, unless a global schedule already covers those dates. Regional schedules are still created by hand.
- CTC and Technical now see the same paper-style timesheet as RM and Finance, above the daily entries they already had. Every reviewer list has a Region column, and anyone covering more than one region gets a Region filter, including on Waiting on me.
- Facility In-Charge has no approval step, because the endorsement was removed. They open **All visible logs**, read-only, for every cadre at their facility, and nothing appears in Waiting on me. CTC In-Charge still verifies.
- Every reviewer can filter by cadre as well as region, on both lists. Regional Finance opens individual work logs from RM authorization onward. CSO Finance opens one only when it is routed to the CSO, so Payroll reaches a CSO through the signed report and salary files.
- **Why:** the user asked for the whole approval route to be checked for every cadre, and for each level to see its own cadres.
- Tanzania's fixed public holidays, Good Friday and Easter Monday are built in. Administrators add Eid al-Fitr, Eid al-Adha, Maulid and one-off days on **Public holidays** once announced, because they cannot be worked out in advance. Holidays show on provider calendars, printed and review timesheets, and salary files. They change no hours, pay or who can record work.
- **Why:** the user asked that providers submit on the 25th, that the next month start on the 26th, and that holidays be seen on the timesheet.

### CSO salary timesheets
- CSO Finance downloads timesheets for salary payment from **CSO payments → Salary timesheets**, as PDF (summary plus one paper-style page per provider, for filing) or CSV (one row per provider, one column per day, for spreadsheets). The screen says which regions are signed; an unsigned region is never silently missing.
- Files come only from the latest Regional Finance Payroll sign-off, limited to the user's CSO, regions and cadres. Sign-off freezes each provider's daily start, end and hours, days signed and salary scale, so later work edits reach the file only after a fresh sign-off. Sign-offs saved before this have totals but no daily times.
- Each provider row shows the **full monthly salary**, bank name, account and branch, and the days the provider signed (days on provider-attested timesheets). The user chose a full monthly salary, not a daily or pro-rated one: days are shown for information. A provider with several placements gets one salary, shown on one row. No salary shows for a timesheet the provider did not sign.
- Central Finance sets salaries on **Salary amounts**: one amount per salary scale, effective from a start month until a later one. Scales can be typed before any staff record uses them, but the text must match the staff record exactly. The file uses the amount in force for the month worked and the bank details saved at download, so a correction applies to later downloads. A scale with no amount shows as missing, never zero, and missing bank details are flagged rather than blocking the download.
- The files leave out indicators, activities, comments, evidence and GPS. Before exporting, the CSO sees a searchable, paged list of every provider in the file: region, facility, cadre, days signed, monthly salary and any payment check. Region, facility and cadre are also on every file row. Bank details and daily times stay in the downloaded file only, and salaries, bank details and daily rows must not reach the on-screen monthly report. Each download is audited with the salaries shown.
- A CSO sees salaries for its assigned regions, for both **facility and community** providers. Sign-off freezes the placement's community area; a community area on the placement makes the provider Community, even if a facility is also linked. Screen and files name the work setting, facility and community area, the CSO can narrow the list and the file to one setting, and the totals show the split. A provider with no CSO on their placement is in no CSO's file, so the screen counts them per region. Confirming the sign-off again saves a new one when a CSO's copy changed, even if the regional totals did not. Sign-offs saved before this have no community area and show Not assigned until confirmed again.
- **Why:** the user asked that a CSO see salary payment for its assigned region for the facility and the community.
- This shows what to pay. It does not create a claim, budget charge or payment record, so Payroll stays report-only in the workflow. The older claim-based Payroll CSV stays for older claims only.
- **Why:** the user asked for CSOs to download the timesheet for salary payment as CSV or PDF, with each provider's total salary, bank details and days signed.

### Regional Finance's two Services approvals
- Regional Finance approves each Services work log twice, in order, on the same record: first the **timesheet** (`finance_timesheet_approve`: days, hours, work), then the **Services payment** (`finance_review`: funding source and fixed daily amount). Routing to FHI360 with a named Central Finance reviewer follows, and the monthly budget deduction still happens only at that routing step.
- The server refuses the payment step until the timesheet approval is saved, with who and when on the work log and in its audit history. Any return, rejection, reopening or new RM authorization clears it, so the record needs a fresh approval. The same Regional Finance person may do both approvals. Signer names stay hidden from non-admins under the audit rule.
- Do not show a budget-left figure in Regional Finance's review. A missing or insufficient budget still blocks routing on the server.
- Payroll is unchanged: it ends at RM approval, with no Finance approval.
- RM and Finance review screens show the task and key numbers first, flags before the timesheet, closed provider details and versions, and a fixed bar to reach the decision. The scroll and confirmation rules stay. Reviewers start on **Waiting on me**.
- **Why:** the user asked for two separate reviews and approvals for the timesheet and Services, recorded as real approvals, and for budget left to be removed from the Regional Finance review.

### Matched FHI360 Services payment proof
- New Services handoffs require Regional Finance to select a named, active Central FHI360 Finance reviewer authorized for the provider's region and cadre. Only the selected person may approve, with no Super Admin substitution; the Regional Finance router cannot select themselves. Unassigned historical routed claims remain unchanged.
- The new claim waits for Central Finance review before becoming ready for payment/export. Reviewer identity and approval time remain with the claim. RM and Regional Finance use the work-log print preview before deciding; Central Finance reviews the print preview and frozen claim amount, then confirms approval. Monthly regional document sign-off also requires its all-provider print preview; it remains documentation only.
- **Why:** the user requested a named regional Services handoff and explicitly chose selected-reviewer-only approval, with print-preview review at RM and Finance levels.
- RM and Finance see one timesheet for every cadre: the bilingual form with dates across the top. It is the first section of the work-log drawer whether or not they have an action to take, and decision controls stay below it. The form includes additional services, so its totals match the server totals.
- Sign-off boxes and Services steps show finished stages as Completed from the current status when audit rows are hidden. Signer names and dates stay with audit administrators.
- **Why:** the user asked for the RM and Finance preview to match the main timesheet for all cadres, and audit history stays limited to administrators.
- Central FHI360 Finance can select up to 25 scoped, routed Services claims and save proof plus matching payment records atomically. The provider names, priced service names and approved amounts must match the current claims. Only outstanding balances are newly recorded; a fully recorded claim awaiting proof is confirmed without another payment record.
- Finance must attest that the uploaded document actually lists the displayed beneficiaries, services and payment amounts. This is manual verification, not OCR or automatic document-content matching. The app records an external payment; it never initiates a bank or wallet transfer.
- Central Finance proof is always required for Services: the `payment_requires_proof` setting cannot turn it off. A recorded Services payment stays Proof Required until proof is attached.
- Central Finance can reverse an exported Route A batch with a required reason, but not once any claim in it has a payment record or proof. Claims return to READY/NOT_STARTED, where they can be cancelled (restoring the monthly budget) or exported again. The batch stays as a REVERSED record, its file cannot be downloaded, and only its creator, its reverser and Oversight can open it.
- Full recorded payment plus the checked proof marks each linked Services claim/work log paid. Standalone legacy/community uploads retain their previous behavior. Reconciliation must still be done by someone other than the payment recorder. Preserve finance role, organization, region and cadre boundaries.
- **Why:** the user wants provider/service names and amounts linked to proof and reflected as paid, without allowing an unrelated upload or a retry to create a false or duplicate payment.

### Super Admin setup transfer
- The version-controlled `database/cadre-forms.sql` contains the standard cadre
  and indicator reference records for future deployments. Follow `database/README.md`
  to apply it explicitly to the intended database after the schema exists.
  Keep it synchronized with the maintained definitions using
  `python scripts/prepare_activity_restore.py --print-reference`; the preparation
  tests check for drift. It contains no accounts or work and is not a publish/startup hook.
- To restore the saved national geography separately, run
  `python scripts/prepare_geography_restore.py`, then manually apply
  `.data/production-geography-restore.sql` to the intended Production database
  with editing enabled. This atomic missing-only data restore preserves location
  IDs and facility links and refuses ambiguous duplicate names. Its saved source
  has 31 regions, 172 councils/districts and 3,644 wards, with the age limitations
  documented in `backend/data/README.md`. It does not run at startup or publish.
- For recovery from a saved setup export after an admin-only reset, use
  `python scripts/prepare_testing_restore.py <saved-export.json>`. It prepares
  missing-only cadre/indicator/geography/section/payment-route foundation SQL
  and a validated JSON for the existing Super Admin Setup transfer screen.
  Apply the foundation manually to the intended database with editing enabled,
  then review/select/apply the JSON through the normal authenticated screen.
  The JSON excludes previous pay periods; it never imports work, approvals,
  payments, passwords or CSO payment authority. Imported users remain inactive
  until an administrator activates them and resets their passwords.
  For user-only recovery, add `--users-only`. This prepares
  `.data/user-restore-foundation.sql` and `.data/user-setup-restore.json`,
  retaining operational users, linked staff/placements and dependent organizations/
  facilities only. It excludes old work, approvals, periods, rates and funding sources.
  Keep files containing user details private and ignored by Git.
  For a one-time reconciliation against an existing Live setup, supply a read-only
  comparison snapshot and explicit identity/location choices:
  `--live-snapshot <private-snapshot.csv> --match-live-user=saved-login=live-login`
  and `--match-live-facility=saved-name=live-name`. Review any remaining conflicts
  rather than guessing. A matched account keeps its Live login, phone, password and
  existing roles; a matched facility keeps its current type and linked location.
  Tanzania local-format mobile numbers are normalized in the transfer document;
  existing stored login numbers are not rewritten.
- If a clean database is missing the three standard cadre/activity forms, run
  `python scripts/prepare_activity_restore.py` and manually apply the generated
  `.data/activity-configuration-restore.sql` in that database's SQL console.
  It is one atomic data-only statement using the maintained form definitions,
  adding missing cadres and indicator fields without overwriting existing setup.
  It does not restore custom regional service rates, create demo records, change
  credentials, migrate schemas, or run at application startup.
  If the owner's console rejects procedural blocks but permits plain INSERTs,
  the same preparation also produces `.data/cadre-selection-restore.sql` and
  `.data/cadre-fields-restore.sql`. Run these two single statements separately,
  in that order, and verify all three cadres and their indicator fields afterward.
  Alternatively, `.data/cadre-forms-restore.sql` restores missing cadres and
  fields in one owner-run statement and returns per-cadre field counts. Copy
  the entire statement; it preserves existing configuration and contains no work records.
- Development and live databases hold independent setup data. Publishing code is not a setup-data synchronization operation. Use the Super Admin **Setup transfer** screen to export, review and explicitly select missing setup on the target site.
- Transfer operational account roles/scopes/cadres, linked provider setup and non-overlapping placements, organizations, facilities with their geofences, programme sources, open periods and fixed daily Services rates only. Exclude administrator accounts, credentials, bank/mobile payment details, work, approvals, financial records, signed reports, proof files and CSO payment authority.
- Existing values, passwords and access are never removed or overwritten. Additional target roles, identity differences, conflicting rates, overlapping placements or periods require manual review. In particular, do not create another period over an existing closed global/regional period; review/reopen it manually.
- New imported accounts are inactive and receive an inaccessible random password hash. Activate and reset through existing Super Admin controls before sign-in. Never copy password hashes or assign a known default password through transfer.
- Review binds the document, actor and target setup for 15 minutes. Apply rechecks under bounded database locks, writes selected missing records atomically and appends administrator-only audit entries. Missing dependencies or stale setup must fail without a partial update.
- **Why:** the user approved a missing-setup-only correction after identical published/preview assets concealed differences in live accounts and configuration; live work, approvals, payments and credentials must remain intact.

### Rejected timesheets and period restarts
- The user approved **archiving used periods**, not erasing their submitted work or approval/audit history. Super Admin may archive an unpaid period after a reason and period-specific confirmation; archive does not create a replacement or invent work entries.
- Archived periods and their work leave active provider/reviewer/finance lists and are read-only. Preserve their records, frozen versions, approval/audit history, cancelled claims and unused budget configuration. A fresh active period may use the same dates. Super Admin can include archived periods in the period list.
- Active claims, completed payments/paid work and committed or spent budget funds block restarting a period. Cancel unpaid claims through their normal Finance workflow first; never erase or transfer financial history to force an archive.
- Rejection by Technical or RM lets the owning CHW/HCP/Data Clerk correct saved days and fill missing eligible dates across the original month. Resubmission restarts at CTC and repeats downstream work approvals. Preserve the rejection reason and frozen review history; do not reuse old confirmation/approval state.
- Provider forms use a **work month**, not a pay-period selector or internal finance labels. Keep underlying schedules for administration, approvals and payments. Reopen the existing matching type/month record, including rejected/returned records on closed or partial-month schedules, rather than creating a duplicate. Providers choose actual workdays from the monthly calendar; selecting a month must not invent or preselect a workday.
- **Why:** the user needs providers to refill rejected monthly work and wants old test/used periods removed from active use, while explicitly choosing archive instead of permanent deletion.

### Operational approval versus payment pricing
- Regional Finance accounts that also hold channel-finance roles should start
  from RM-approved work: monthly reports for Payroll, routing review for Services.
  Do not send them into the legacy manual-claim form or remove the server-side
  new-claim routing gate to make that form succeed.
  **Why:** mixed-role users otherwise see a manual preparation option that is
  invalid for new records; user-requested Regional Finance work must use its gate.
- Keep providers grouped by cadre in the regional monthly report. Large cadre
  lists must remain compact and searchable, with full-month totals independent
  of list filtering or pagination.
 - Payroll is a work report only: CTC verification → Technical review → RM approval.
   It has no activity-rate requirement, budget gate, payment approval or payment routing.
   A later regional monthly report sign-off is for documentation, not payment.
  Finance sees calendar-month indicator and hour totals across all assigned cadres
  on one page, respecting region, cadre and CSO scope. Totals use actual entry dates,
  not whole pay-period spans; indicator sums are activity counts, not unique clients.
  **Why:** the user explicitly chose to keep work approvals only for Payroll.
- Services remains payable: RM may authorize work with missing payment amounts,
  but Finance must resolve daily Services pricing before routing payment; current Services do not require a budget gate.
  Never create a zero-value claim merely to advance an operational approval.
- Only absent Services financial terms may be quoted from an exact matching
  Region × Cadre × service rate effective on the work date. Conflicting rates
  fail explicitly. Keep the highest service amount once per provider-date.
- Preserve original clinical entry snapshots, saved positive financial terms,
  and frozen claim calculations, including completed payments. New rate setup
  must never silently recalculate existing claims.
- Preserve committed and paid historical Payroll financial records. Only
  uncommitted proposals may be retired when applying the reporting-only policy,
  retaining RM approval and recording append-only system history.
- **Why:** missing Services finance setup must not prevent operational work approval, but
  operational approval is not evidence that a payment amount or budget is valid.

### Explicit testing resets
- A full testing-data reset is a manually authorized maintenance operation, never a Git-pull, startup, build or publishing hook. Do not automatically import demo accounts or fixtures afterward.
- An admin-only reset preserves the existing Super Admin credentials and permissions, required system role definitions and migration metadata, not business setup. Regions, cadres and other setup must be configured again when the user chooses this option.
- Keep identity sequences advancing rather than recycling deleted user IDs. Old signed sessions must never become valid for a different newly created account.
- Verify resets and workflows only in independently disposable databases; tests must not repopulate the empty Preview or Live database.
- **Why:** the user explicitly requested clean testing databases, keeping only Super Admin, and asked that Git pull not restore old or trial database content.

### Finance corrections and work duration
- Central Finance can download scoped monthly Services payment documentation as CSV/PDF. Include region, facility, provider, all recorded service names and worked days, payable days, frozen service amounts, currency totals, mobile number, claim reference and payment status. Never recalculate routed amounts from current rates; show non-selected same-day services with zero payable amount. Wallet numbers take precedence over registered contact numbers, and the export explains the fallback.
- Services continue through Regional Finance review and explicit routing to a named authorized Central Finance reviewer. Payroll stays report-only: CTC → cadre Technical → RM → Regional Finance monthly report sign-off → assigned CSO's scoped report/export. CSO receipt of documentation is not automatic payroll payment or a new financial approval.
- Facility ownership choices are Public, Police, Prison and combined Police/Prison (PnP). Preserve existing stored type codes and keep this classification separate from funding sources and payment routes.
- Claim queues are paged; monthly Services exports must not inherit the list-screen row limit. Keep report indexes in ORM metadata and Alembic migrations for deployment. Validate large datasets only in disposable test databases; a large export test is not evidence of concurrent-user capacity.
- **Why:** the user requested Central Finance payment documents, clear CSO Payroll handoff, facility classifications and deployment-ready storage for more than 1,000 providers.
- Regional Finance returns Services to the provider's cadre/region Technical queue, not directly to the provider. Technical must endorse and RM must authorize again. Reject sends work to the editable provider and resubmission restarts CTC review. Retire pending financial claims and clear the old finance review before either correction path; never bypass routed/paid claim protection.
- Display work duration as whole hours plus minutes, not decimal hours. Direct-entry forms separate whole hours and minutes. Preserve fractional-hour storage for accurate totals and financial history; new elapsed-time calculations retain six decimals rather than rounding each day to hundredths.
- **Why:** the user requested Finance-to-Technical returns, rejection back to providers, and no decimal hours on timesheets or Services. Minutes must not be lost by rounding work to whole hours.

### Test code and publishing
- Keep `backend/tests` in source control for regression checks, but exclude it and `.pytest_cache` from the published bundle through `.replitignore`.
- Do not copy test fixtures or simulated test behavior into runtime services. The real backend must remain independent of the tests.
- **Why:** the user chose publishing exclusions instead of deleting the tests, keeping the checks without shipping backend test fixtures.
