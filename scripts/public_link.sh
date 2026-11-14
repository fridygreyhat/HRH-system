#!/usr/bin/env bash
# Give the running system a public https link through a Cloudflare quick tunnel (no warning page, no account),
# and open the tunnel again if it drops.
#
#   scripts/public_link.sh               run here; the link is printed; Ctrl+C closes it
#   scripts/public_link.sh --background  run on its own; the link is in .data/run/public_url.txt
#   scripts/stop_local.sh                close it (and stop the system)
#
# The link changes every time the tunnel opens. Log: .data/logs/tunnel.log
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p .data/logs .data/run
LOG=.data/logs/tunnel.log PIDFILE=.data/run/tunnel.pid URLFILE=.data/run/public_url.txt
CLOUDFLARED=$(command -v cloudflared || echo /opt/homebrew/bin/cloudflared)
[[ -x $CLOUDFLARED ]] || { echo "Install cloudflared first: brew install cloudflared" >&2; exit 1; }

if [[ -f $PIDFILE ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "The public link is already open: $(cat "$URLFILE" 2>/dev/null || echo 'see .data/logs/tunnel.log')"
  exit 0
fi
if [[ "${1:-}" == "--background" ]]; then
  nohup perl -e 'use POSIX; POSIX::setsid(); exec @ARGV' "$0" >/dev/null 2>&1 </dev/null &
  for _ in $(seq 1 30); do
    sleep 1
    if [[ -s $URLFILE ]]; then echo "Public link: $(cat "$URLFILE")"; exit 0; fi
  done
  echo "The tunnel is starting; the link will appear in $URLFILE (log: $LOG)"
  exit 0
fi

echo $$ >"$PIDFILE"
rm -f "$URLFILE" .data/run/stop
trap 'rm -f "$PIDFILE" "$URLFILE"' EXIT
curl -s -m 5 -o /dev/null http://127.0.0.1:5000/api/health ||
  echo "Note: the system is not answering on http://localhost:5000 yet. Start it with scripts/keep_running.sh --background"
while true; do
  if [[ -f $LOG ]] && (( $(wc -c <"$LOG") > 5 * 1024 * 1024 )); then mv "$LOG" "$LOG.1"; fi
  echo "$(date '+%F %T') public_link: opening the tunnel" >>"$LOG"
  # A quick link can expire on Cloudflare's side ("Tunnel not found"); cloudflared then retries forever, so stop it
  # and the loop below opens a fresh link.
  "$CLOUDFLARED" tunnel --no-autoupdate --url http://127.0.0.1:5000 2>&1 | tee -a "$LOG" | while read -r line; do
    case $line in
      *"Tunnel not found"*)
        echo "$(date '+%F %T') public_link: the link expired on Cloudflare's side; opening a new one" | tee -a "$LOG"
        rm -f "$URLFILE"
        pkill -f "cloudflared tunnel --no-autoupdate --url http://127.0.0.1:5000"
        break ;;
      *trycloudflare.com*)
        url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' <<<"$line" | head -1)
        [[ -n $url ]] && { echo "$url" >"$URLFILE"; echo "$(date '+%F %T') Public link: $url"; } ;;
    esac
  done
  [[ -f .data/run/stop ]] && break
  echo "$(date '+%F %T') public_link: the tunnel closed; opening it again in 5 seconds (the link will change)" | tee -a "$LOG"
  sleep 5
done
