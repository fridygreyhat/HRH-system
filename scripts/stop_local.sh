#!/usr/bin/env bash
# Stop the system and the public link started by keep_running.sh and public_link.sh.
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p .data/run
touch .data/run/stop  # tells both loops not to start again
for name in tunnel app; do
  pidfile=.data/run/$name.pid
  [[ -f $pidfile ]] || continue
  pid=$(cat "$pidfile")
  # Each runs in its own process group, so this also stops the server, the worker and cloudflared.
  kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null
  rm -f "$pidfile"
done
# Anything started by hand with scripts/start_local.sh.
pkill -f scripts/run_replit.py; pkill -f "uvicorn backend.replit_app"; pkill -f "python -m backend.worker"
rm -f .data/run/public_url.txt
echo "Stopped."
