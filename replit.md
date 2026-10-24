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
- User-specified limits are **8.5 hours/day** and **45 hours/Monday–Sunday week**,
  summed across the provider's logs. The API serializes staff entry edits to prevent
  concurrent writes from bypassing those limits.
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
