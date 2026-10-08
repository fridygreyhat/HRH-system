# HRH Digital Work-Log, Payment Claims, Payroll Routing and CSO Disbursement Tracking

Tracks HRH staff work from the daily log through sequential approval, a separately priced payment claim,
budget control, routing to the right payor, FHI360 → CSO handoff, and the externally executed payment with proof
and reconciliation. Built to the *Authoritative Master Development Prompt*.

> The MVP **never initiates bank or mobile-wallet transfers**. It prepares and routes approved liabilities and
> records payments made outside the system. There is **no live connection** to the FHI360 HQ budget tracker; FHI360
> budget lines move through a controlled CSV import/export.

## Run

```sh
docker compose up --build
```

Everything is served from **one URL: http://localhost:3000**. nginx serves the React app and proxies `/api` to
the backend, so browsers never talk to a second origin.

| What | Where |
|----------|-------------------------------------------------|
| Web app  | http://localhost:3000 |
| API      | http://localhost:3000/api (also directly on :8001 for scripts) |
| API docs | http://localhost:3000/api/docs |
| Worker   | `worker` service: SMS outbox + hourly reminders |
| Backend tests | `docker compose run --rm --no-deps backend pytest -q backend/tests` |
| Frontend checks | `cd frontend && docker build --target build -t hrh-fe . && docker run --rm -e CI=true hrh-fe sh -c "npx tsc --noEmit -p . && npx react-scripts build"` |

The web app has a light/dark theme switch, an English/Kiswahili switch, a sidebar that becomes a slide-in menu
on phones, and a dashboard with charts (each chart has a table view).

On start the backend runs `alembic upgrade head` and the idempotent seed (`python -m backend.seed`).
Tests create and drop their own `hrh_test` database.

### First-time setup

A fresh system contains only base configuration: roles, sections, the three cadre forms, payment routes A/B/C,
SMS templates, the FHI360 organization, and one system administrator (`ADMIN_USERNAME` / `ADMIN_PASSWORD`,
`admin` / `admin12345` unless you set them; the first sign-in forces a new password). There are no sample users, places, rates or
budgets. Set the system up in this order:

1. **System administrator → Administration → Users:** create the central administrator, finance, RPM, technical
   officer and other accounts, with their roles and scopes. New accounts get a temporary password that must be
   changed at first sign-in.
2. **Central administrator → Administration → Configuration:** regions, clusters, districts, wards, facilities
   (with geofences), community areas and CSOs; check the cadre forms.
3. **Central / regional administrator → Staff registry:** import the approved roster (CSV) or add staff, then give
   providers logins.
4. **FHI360 Finance:** pay periods, funding sources and claim categories (route, payor, budget owner), proposed
   rate rules (approved by an RPM or oversight user), and budget lines (or a tracker import).
5. **SMS:** configure a real SMS gateway (see the production checklist). Without one, providers cannot receive
   the confirmation code they need to confirm a verified work log.

`EXPOSE_DEV_OTP=true` (development only, with the mock gateway) shows confirmation codes on screen instead.

## How it works

**Work log** (same order for every cadre: CHW, Data Clerk and HCP):

```
DRAFT → PENDING_CTC_VERIFICATION → PENDING_PROVIDER_OTP_CONFIRMATION → PENDING_TECHNICAL_REVIEW
      → PENDING_RPM_AUTHORIZATION → APPROVED
```

- Cadre forms reproduce every row of the supplied CHW, Data Clerk and HCP sheets (Kiswahili and English labels,
  `cadres` / `cadre_form_fields`). CHWs enter hours directly. Data Clerks and HCPs enter start and end times, and the
  server calculates the hours.
- CTC verification freezes a **version snapshot** and sends a 4-digit OTP. The provider confirms exactly that
  version. Any return to the provider restarts the whole chain.
- Reviewers can return a log to the provider with field-level flags, return it to the previous reviewer, or reject
  it. The RPM can place a log on budget hold, release it, or reopen an approved log (only when no live claims
  exist). Every return, reject, hold, release or reopen needs a reason.
- The HCP form's Facility In-Charge endorsement is required before technical endorsement (configurable per cadre).
- GPS is sampled only at configured events (`gps_capture_events`). Facility staff are compared with the facility
  geofence. CHW samples go to the supervisor for review. Location exceptions never auto-reject work.

**Claim** (separate from the work log; priced only from ACTIVE, approved, effective-dated `rate_rules`):

```
DRAFT / VALIDATION_NEEDED / PENDING_COMMUNITY_VERIFICATION → AWAITING_APPROVAL → APPROVED | HELD
      → READY → EXPORTED (batch) → HANDED_OFF (Route B)                      CANCELLED
payment_status: NOT_STARTED → PENDING → PARTIALLY_RECORDED → PROOF_REQUIRED → PAID → RECONCILED (or FAILED)
```

| Route | Prepared / approved by | Paid by | Notes |
|---|---|---|---|
| A — FHI360 activity | FHI360 Finance (two different people) | FHI360 Finance | CSOs cannot see it |
| B — facility payroll | FHI360 Finance | Assigned CSO | Export → FHI360 hand-off → CSO acknowledges receipt → CSO pays, uploads proof |
| C — community service | CSO Finance (two different people) | Assigned CSO | Without an HRH work log, a community verifier checks the claim first |

- Missing configuration never becomes a guessed value. If a route, payor, CSO, funding source, rate rule or budget
  line is missing, the claim shows the exception as `VALIDATION_NEEDED`. A rate change after preparation blocks
  approval until the claim is revalidated.
- Approval commits budget with row locks and a `committed + spent ≤ allocated` database constraint. A shortfall
  puts the claim on `HELD` and shows the shortfall. Reallocation and release follow, and every movement is recorded
  in the append-only `budget_transactions` ledger.
- A claim is `PAID` only after an authorized payment record for the full amount **and** proof. Reconciliation must
  be done by someone other than the person who recorded the payment.
- Exports create immutable payroll batches (snapshot + CSV, XLSX on download) per route, payor and executor.

**SMS:** state changes queue messages in `sms_outbox` within the same transaction. The worker sends them after
commit, retries with backoff, and suppresses stale messages. The hourly reminder check notifies the assigned
reviewer about logs pending more than 48 hours, and repeats no more often than every 48 hours. Templates are
versioned in Kiswahili and English, validated, and can be previewed. The OTP message is protected, is never
stored in plaintext, and is never logged. SMS never includes amounts, GPS or patient data.

**Sign-in:** an account locks for 15 minutes after 5 wrong passwords in a row (both are settings), and the
system administrator can unlock it. Every sign-in attempt, successful or not, is audited, and unknown usernames
get the same answer as wrong passwords. Accounts created or reset by an administrator get a temporary password
that must be changed before anything else works. Changing or resetting a password ends every other session.

**Security:** role-based access control plus per-role scopes (facility, community area, cluster, region,
organization) on every query and action. CSOs are isolated by organization. Oversight is read-only. GPS,
phone numbers and payment details are hidden from roles that don't need them, and access to payment details is
audited. `work_log_audit`, `claim_audit`, `budget_transactions` and `audit_events` are append-only (database
triggers).

## Code map

```
backend/
  models/          SQLAlchemy models (org, users, staff, worklogs, claims, budgets, notifications, audit)
  alembic/         migrations (append-only triggers, vw_workflow_bottlenecks)
  services/        scope, worklog_workflow, forms, otp, geo, claims, budgets, batches, payments,
                   staff_registry, notifications, templates, sms_gateway
  api/endpoints/   auth, worklogs, claims, batches, budgets, staff, admin, dashboard
  worker.py        outbox delivery + reminders
  seed.py          base configuration (no sample data)
  tests/           acceptance tests mapped to the master prompt's section 17 (sample data in tests/demo_data.py)
frontend/          React + TypeScript (CRA), built and served by nginx (nginx.conf proxies /api)
```

## Production checklist

- Copy `.env.example` to `.env` and fill it in; `docker compose` reads it automatically and it is never committed.
- Set `SECRET_KEY` (32+ random bytes), `ADMIN_PASSWORD`, `CORS_ORIGINS`, and keep `EXPOSE_DEV_OTP=false`.
- Configure an SMS gateway (`SMS_GATEWAY_TYPE=twilio` plus credentials, or add a local provider in
  `services/sms_gateway.py`).
- Serve behind TLS. Back up Postgres and the `uploads` volume, which holds payment proofs.
- Have a native speaker review the Kiswahili labels for the Data Clerk and HCP forms and the SMS templates.

## Decisions HRH still needs to make

The system can hold each of these decisions as configuration, but none of them has been decided or entered yet:

- Salary scales, salary and proration formulas, activity rates, transport and communication rules, caps and
  rounding. Enter them as rate rules; each needs approval by an RPM or oversight user.
- How each activity or category maps to a funding source, payor, route and budget line (claim categories).
- Final FHI360 and CSO voucher and export layouts (the current CSV/XLSX columns are a working draft).
- The FHI360 HQ tracker API or file format, line identifiers and reconciliation procedure (the current CSV import
  and export are a placeholder boundary).
- The CSO budget source and owner, and reallocation approvals.
- Pre-registration versus enrollment-on-engagement policy (both roster import and engagement-list import are
  supported).
- Cluster boundaries, reviewer assignments, community verifier roles and geofences (user scopes, facilities).
- Whether bank or mobile-wallet transfers are ever initiated from the app (not in the MVP).
- Proof acceptance rules (`payment_requires_proof`) and any escalation beyond the 48-hour reminder
  (`escalation_recipient_roles`, currently unused).
- Location and record retention, staff consent notices, correction and archival policies.
