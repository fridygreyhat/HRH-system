#!/usr/bin/env bash
# Keep the whole system running on this computer: start it, and start it again if it ever stops.
#
#   scripts/keep_running.sh               run here; Ctrl+C stops it
#   scripts/keep_running.sh --background  run on its own, after this terminal closes too
#   scripts/stop_local.sh                 stop it (and the public link)
#
# Log: .data/logs/app.log (requests, the worker, start-ups and restarts).
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p .data/logs .data/run
LOG=.data/logs/app.log PIDFILE=.data/run/app.pid

if [[ -f $PIDFILE ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "The system is already being kept running (process $(cat "$PIDFILE")). Log: $LOG"
  exit 0
fi
if [[ "${1:-}" == "--background" ]]; then
  # A new session, so closing the terminal or ending an editor session does not stop it.
  nohup perl -e 'use POSIX; POSIX::setsid(); exec @ARGV' "$0" >/dev/null 2>&1 </dev/null &
  echo "Started in the background: http://localhost:5000  Log: $LOG"
  exit 0
fi

echo $$ >"$PIDFILE"
rm -f .data/run/stop
trap 'rm -f "$PIDFILE"' EXIT
while true; do
  # Keep the log from growing without limit: one previous file is kept.
  if [[ -f $LOG ]] && (( $(wc -c <"$LOG") > 20 * 1024 * 1024 )); then mv "$LOG" "$LOG.1"; fi
  echo "$(date '+%F %T') keep_running: starting the system" >>"$LOG"
  scripts/start_local.sh >>"$LOG" 2>&1
  code=$?
  [[ -f .data/run/stop ]] && { echo "$(date '+%F %T') keep_running: stopped on request" >>"$LOG"; break; }
  echo "$(date '+%F %T') keep_running: the system stopped (exit code $code); starting it again in 5 seconds" >>"$LOG"
  sleep 5
done
