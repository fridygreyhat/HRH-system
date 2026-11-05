#!/usr/bin/env bash
# Run the whole system on this computer without Docker: API, web app and worker on http://localhost:5000.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "Missing .env. Copy .env.example to .env and fill it in (see README, 'Run without Docker')." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
. ./.env
set +a
: "${DATABASE_URL:?Set DATABASE_URL in .env}"
export HOST="${HOST:-127.0.0.1}" UPLOAD_DIR="${UPLOAD_DIR:-$PWD/.data/uploads}"

if [[ ! -x .venv/bin/python ]]; then
  command -v uv >/dev/null || { echo "Install uv first: https://docs.astral.sh/uv/" >&2; exit 1; }
  uv sync --frozen
fi
[[ -d node_modules ]] || npm ci
[[ -f frontend/build/index.html ]] || npm run build

.venv/bin/python -m alembic -c backend/alembic.ini upgrade head
.venv/bin/python -m backend.seed
exec .venv/bin/python scripts/run_replit.py
