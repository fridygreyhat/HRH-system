#!/usr/bin/env bash
# Give the running system a public https link through a Cloudflare quick tunnel (no warning page, no account),
# and open the tunnel again if it drops.
#
#   scripts/public_link.sh               run here; the link is printed; Ctrl+C closes it
#   scripts/public_link.sh --background  run on its own; the link is in .data/run/public_url.txt
#   scripts/stop_local.sh                close it (and stop the system)
#
# Without an ngrok fixed address (below), the link changes every time the tunnel opens. Log: .data/logs/tunnel.log
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p .data/logs .data/run
LOG=.data/logs/tunnel.log PIDFILE=.data/run/tunnel.pid URLFILE=.data/run/public_url.txt EDGE_TRIES=.data/run/edge_tries
# Cloudflare data centres near Tanzania (Dar es Salaam, Mombasa, Nairobi): a link through one of them answers fastest.
NEAR_EDGES=${NEAR_EDGES:-"dar mba nbo"}
MAX_EDGE_TRIES=${MAX_EDGE_TRIES:-5}
CLOUDFLARED=$(command -v cloudflared || echo /opt/homebrew/bin/cloudflared)
[[ -x $CLOUDFLARED ]] || { echo "Install cloudflared first: brew install cloudflared" >&2; exit 1; }

if [[ -f $PIDFILE ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "The public link is already open: $(cat "$URLFILE" 2>/dev/null || echo 'see .data/logs/tunnel.log')"
  exit 0
fi
if [[ "${1:-}" == "--background" ]]; then
  nohup perl -e 'use POSIX; POSIX::setsid(); exec @ARGV' "$0" >/dev/null 2>&1 </dev/null &
  for _ in $(seq 1 90); do  # a link far from Tanzania is replaced, which can take a minute
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

# A fixed address: with an ngrok account (its authtoken added once with `ngrok config add-authtoken ...`) and its free
# domain written in .data/public_domain, the link is always https://<that domain>, after an internet drop or a restart too.
DOMAIN=$(tr -d '[:space:]' <.data/public_domain 2>/dev/null); DOMAIN=${DOMAIN#https://}; DOMAIN=${DOMAIN%/}
if [[ -n $DOMAIN ]]; then
  NGROK=$(command -v ngrok || echo /opt/homebrew/bin/ngrok)
  [[ -x $NGROK ]] || { echo "Install ngrok first: brew install ngrok" >&2; exit 1; }
  while true; do
    if [[ -f $LOG ]] && (( $(wc -c <"$LOG") > 5 * 1024 * 1024 )); then mv "$LOG" "$LOG.1"; fi
    echo "$(date '+%F %T') public_link: opening https://$DOMAIN (ngrok)" | tee -a "$LOG"
    # ngrok reconnects by itself after a drop and keeps the same address; the loop only restarts it if it exits.
    "$NGROK" http 127.0.0.1:5000 --url "https://$DOMAIN" --log stdout --log-format logfmt 2>&1 | tee -a "$LOG" |
      while read -r line; do
        case $line in
          *"started tunnel"*) echo "https://$DOMAIN" >"$URLFILE"; echo "$(date '+%F %T') Public link: https://$DOMAIN" ;;
          *ERR_NGROK*|*"lvl=crit"*) echo "$(date '+%F %T') public_link: ngrok: $line" ;;
        esac
      done
    rm -f "$URLFILE"
    [[ -f .data/run/stop ]] && exit 0
    echo "$(date '+%F %T') public_link: ngrok stopped; starting it again in 10 seconds (same address)" | tee -a "$LOG"
    sleep 10
  done
fi

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
        # Held back until the tunnel connects, so a link that is about to be replaced is never handed out.
        pending=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' <<<"$line" | head -1) ;;
      *"Registered tunnel connection"*)
        [[ -n ${checked:-} ]] && continue  # only a link's first connection decides; a later reconnect keeps the link
        checked=1
        edge=$(grep -oE 'location=[a-z0-9]+' <<<"$line" | head -1)
        edge=${edge#location=}
        tries=$(cat "$EDGE_TRIES" 2>/dev/null || echo 0)
        # Cloudflare picks the data centre each time a link opens. Far away (Durban, Johannesburg, Europe) every request
        # takes about twice as long for users in Tanzania, so open a new link, a few times at most.
        if [[ " $NEAR_EDGES " != *" ${edge:0:3} "* ]] && (( tries < MAX_EDGE_TRIES )); then
          echo $((tries + 1)) >"$EDGE_TRIES"
          echo "$(date '+%F %T') public_link: connected through Cloudflare $edge, far from Tanzania; opening a new link ($((tries + 1)) of $MAX_EDGE_TRIES)" | tee -a "$LOG"
          pkill -f "cloudflared tunnel --no-autoupdate --url http://127.0.0.1:5000"
          break
        fi
        rm -f "$EDGE_TRIES"
        [[ -n ${pending:-} ]] && { echo "$pending" >"$URLFILE"; echo "$(date '+%F %T') Public link: $pending (Cloudflare $edge)"; } ;;
    esac
  done
  [[ -f .data/run/stop ]] && break
  echo "$(date '+%F %T') public_link: the tunnel closed; opening it again in 5 seconds (the link will change)" | tee -a "$LOG"
  sleep 5
done
