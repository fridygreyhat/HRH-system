# HRH Pay on Replit

## Run

Use the **Run** button (`Start application`), or `npm start` from the project root.
The workflow runs `scripts/run_replit.py`, which starts Uvicorn and the existing
notification worker together. It stops both processes when the workflow stops.

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

## First sign-in

Username: **admin**. Use the initial password entered as the `ADMIN_PASSWORD`
Replit Secret. The app requires changing it at first sign-in.

The database has only the repository's base configuration and administrator;
no demo users, rates, staff or budgets were added. Follow the README's first-time
setup sequence to configure the organization and staff.

The bootstrap secret is only used to create the account. Changing it later does
not reset the password of an existing account.

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
- New backdated entries have a **48-hour** grace period measured from activity
  completion. Date-only CHW entries use the end of the local workday. Corrections
  to previously recorded dates remain available in editable/returned logs, with
  audit history, so the review-and-return workflow does not become impossible.
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
  Unpriced work cannot pass final finance review.
- Technical, RPM, Regional Finance and new channel-finance records enforce
  **Region × Cadre** scopes. Configure reviewer cadres and region scopes for
  these users; CSO Finance additionally requires the assigned CSO organization.
- Routing creates a budget-committed READY claim; it is not a bank transfer.
  Insufficient budget holds both the claim and log. Only a fully recorded actual
  payment, with required evidence, marks the log PAID.
- Reviewer controls remain below daily entries and monthly totals. The UI requires
  reaching the end and confirming the correct work type; the API independently
  requires that confirmation and enforces scope, stage and version checks.

## SMS and file storage

- SMS remains in the repository's **mock** mode, with development OTP exposure
  disabled. No real SMS messages are sent. Confirmation-dependent workflows need
  either a configured real gateway or an explicit development-only OTP setting.
- On Replit, payment proofs are written to `.data/uploads`, which is excluded
  from Git. These local files are for workspace development, not durable
  published-app storage. Configure durable object storage before using real
  payment proofs in production.
- Schema migrations and seeding are intentionally not part of normal startup.
  For managed production PostgreSQL, use Replit's Publish schema flow rather
  than running development migrations on production.
