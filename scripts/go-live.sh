#!/usr/bin/env bash
# go-live.sh — flip the booking API from "not-configured" to live.
#
# Prompts for the account-bound values (or reads them from the environment):
#   RESEND_API_KEY, MEETING_URL, TURNSTILE_SITE_KEY, TURNSTILE_SECRET
# then sets the Worker secrets via stdin (never on a command line), writes the
# Turnstile site key into index.html + manage.html, commits + pushes, and polls
# https://api.otakar.dev/health until it reports ready:true.
# Leave any prompt blank to skip it — safe to re-run piecemeal.
# Needs: a `wrangler login` on this machine (worker/ uses it), git push access.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
API=${API_BASE:-https://api.otakar.dev}

ask() { # ask VAR "prompt" [secret]
  local var=$1 prompt=$2 secret=${3:-}
  if [ -n "${!var:-}" ]; then echo "  $var: taken from environment"; return; fi
  # EOF (no terminal / piped input) counts as "skip", not as an error.
  if [ -n "$secret" ]; then read -r -s -p "$prompt: " "$var" || true; echo; else read -r -p "$prompt: " "$var" || true; fi
}
echo "OJA booking API — go live. Blank = skip."
ask RESEND_API_KEY     "Resend API key" secret
ask MEETING_URL        "Reusable video meeting URL (e.g. your Google Meet / Zoom room)"
ask TURNSTILE_SITE_KEY "Turnstile site key (public, starts with 0x)"
ask TURNSTILE_SECRET   "Turnstile secret key" secret

put() { printf '%s' "$2" | (cd "$ROOT/worker" && npx wrangler secret put "$1" >/dev/null) && echo "  set Worker secret $1"; }
if [ -n "${RESEND_API_KEY:-}" ]; then put RESEND_API_KEY "$RESEND_API_KEY"; fi
if [ -n "${MEETING_URL:-}" ]; then
  case "$MEETING_URL" in https://*) put MEETING_URL "$MEETING_URL" ;; *) echo "  MEETING_URL must start with https:// — skipped" ;; esac
fi
if [ -n "${TURNSTILE_SECRET:-}" ]; then put TURNSTILE_SECRET "$TURNSTILE_SECRET"; fi

if [ -n "${TURNSTILE_SITE_KEY:-}" ]; then
  if [[ ! "$TURNSTILE_SITE_KEY" =~ ^0x[A-Za-z0-9_-]+$ ]]; then echo "  Turnstile site key looks wrong (expected 0x…) — skipped"; else
    cd "$ROOT"
    for f in index.html manage.html; do
      perl -pi -e 's/(turnstileSiteKey:\s*)"[^"]*"/$1"'"$TURNSTILE_SITE_KEY"'"/' "$f"
    done
    git add index.html manage.html
    if git diff --cached --quiet; then echo "  site key already in place"; else
      git commit -q -m "Set Turnstile site key" && git push -q origin master && echo "  site key committed + pushed (Pages redeploys in ~1 min)"
    fi
  fi
fi

echo "Polling $API/health …"
for _ in $(seq 1 12); do
  h=$(curl -sS --max-time 10 "$API/health" || true)
  echo "  $h"
  if printf '%s' "$h" | grep -q '"ready":true'; then echo "LIVE — the scheduler on otakar.dev now accepts bookings."; exit 0; fi
  sleep 5
done
echo "Not ready yet — set the secrets listed under \"missing\" and re-run."; exit 1
