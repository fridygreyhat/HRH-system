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

The original backend acceptance-test harness creates/drops a database called
`hrh_test` on the configured PostgreSQL server and assumes fixture passwords.
Do not run it against production or a server with an existing database of that
name. It was not run as part of this setup.

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
