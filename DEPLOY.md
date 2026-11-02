# OJA Solutions — Deployment Runbook

Two independently-deployed parts:

| Part | Where it runs | How it deploys |
| --- | --- | --- |
| **Site** (`index.html`, `manage.html`, `assets/`) | GitHub Pages → `otakar.dev` | push to `master` (Pages serves repo root) |
| **API** (`worker/`) | Cloudflare Worker + D1 → `api.otakar.dev` | `wrangler deploy` |

The site calls the API from the browser; the two share no build step. The API
is **free-tier only** (Workers + D1 + Resend free limits; paid overages off).

> **Status 2026-11-01:** the site is LIVE on otakar.dev from `master` (scheduler
> v2 shipped). The API (`worker/`) is **deployed to api.otakar.dev** with the
> D1 schema at migration 0002 and `MGMT_TOKEN_SALT` set, but it answers **503
> "not-configured"** — so the page still shows its email fallbacks — until the
> three account-bound secrets exist (§2.3–2.5: Resend key, Turnstile, meeting
> link). `curl https://api.otakar.dev/health` lists exactly what is missing.
> Setting the secrets flips it live with no redeploy. The 7 illustrative
> `data-draft="invented"` items shipped as-is (owner's call to launch).

---

## 1. Frontend (GitHub Pages)

Already configured: Pages serves the repo **root** of `master` at `otakar.dev`
(`CNAME` + `.nojekyll` present). To release the reworked site + booking UI:

1. Ground/remove the `data-draft` items (launch gate above).
2. Set the production Turnstile **site key** in both `index.html` and
   `manage.html` — the inline `window.OJA` config:
   ```js
   window.OJA = { apiBase: "https://api.otakar.dev", turnstileSiteKey: "0x...", emailUser: "hello", emailDomain: "otakar.dev" };
   ```
   (Get the key in step 2.4. Leaving it empty disables the widget; the API
   still works but without bot challenge.)
3. Merge `frontend-rework` → `master` and push. Pages redeploys in ~1 min.

No API is required for the page to load — if the Worker is down, the scheduler
shows the email fallback and the inquiry form falls back to a `mailto:`.

---

## 1b. Cloudflare-side hardening (zone settings; dashboard or a scoped API token)

The site is served through Cloudflare's proxy, so HTTPS enforcement and security
headers live at Cloudflare, **not** GitHub. GitHub Pages reports
`https_certificate: null` for otakar.dev (the proxy prevents GitHub from
provisioning one) — **never enable "Enforce HTTPS" on the GitHub Pages
settings page**; it would redirect-loop and take the site down.

Note (2026-11-01): `.dev` is on the browser HSTS preload list, so every
browser already refuses plain HTTP for otakar.dev and its subdomains — the
toggles below are belt-and-braces for non-browser clients, not a security gap.

Checklist (as of 2026-10-25 none of these are on; plain `http://otakar.dev`,
`utah.otakar.dev` and `jana.otakar.dev` all answer 200 without redirecting):

1. **Always Use HTTPS**: Cloudflare dashboard → otakar.dev → SSL/TLS → Edge
   Certificates → *Always Use HTTPS* → On. Covers every proxied host in the zone.
2. **HSTS** (same page): enable, max-age 6 months; leave *Include subdomains*
   and *Preload* off until every subdomain is confirmed HTTPS-only.
3. **SSL/TLS mode**: keep *Full* (not Strict — GitHub has no cert for this host).
4. **www** — DONE 2026-10-25: `oja-www-redirect` Worker deployed from
   `www-redirect/` (custom domain `www.otakar.dev`, 301 to the apex, keeps
   path + query). Redeploy with the command in its README after any change.

The local wrangler OAuth login has `zone:read` only (verified 2026-10-25: zone
`fa024aeb576bbc42e72c519755cae6dc` lists, but DNS records, every zone setting
and rulesets return 403), so steps 1–3 need the dashboard or an API token with
*Zone → Zone Settings: Edit* (+ *Zone: Read*) scoped to otakar.dev. The
`CLOUDFLARE_API_TOKEN` used by the utah-snow CI exists only as a GitHub Actions
secret and is (likely) Workers-scoped.

---

## 2. Backend (Cloudflare Worker + D1 + Resend + Turnstile)

Prereqs: a Cloudflare account (the `otakar.dev` zone already lives there), a
Resend account, Node 20+, and `cd worker && npm install`.

### 2.1 Log in & create the database — DONE 2026-10-25
`oja-booking` exists (id `18a16ae7-27f1-4313-9ec1-dd3cb09a479c`, region WNAM) and
is already in `wrangler.toml`. Nothing to do unless you recreate it.

### 2.2 Apply the schema — DONE through 0002 (2026-11-01)
Both migrations are applied remotely. For future migrations:
```bash
npm run db:migrate:remote      # wrangler d1 migrations apply oja-booking --remote
```

### 2.3 Resend (transactional email)
1. Create a Resend account; **Add Domain** `otakar.dev`.
2. Resend shows DNS records (SPF/DKIM, and a return-path). Add them in the
   **Cloudflare DNS** dashboard for the `otakar.dev` zone, then **Verify**.
3. Create an API key. The sender (`RESEND_FROM`, default
   `OJA Solutions <hello@otakar.dev>`) must be on the verified domain.
4. Make sure `hello@otakar.dev` can **receive** mail (Cloudflare Email Routing
   or a mailbox) — it's the owner-notification + reply-to address.

### 2.4 Turnstile (bot protection)
1. Cloudflare dashboard → **Turnstile** → add a widget for `otakar.dev`
   (add `127.0.0.1` too for local testing).
2. Copy the **site key** → frontend `window.OJA.turnstileSiteKey` (step 1.2).
3. Copy the **secret key** → set it as `TURNSTILE_SECRET` (next step).

### 2.5 Set secrets — or run `scripts/go-live.sh`
`scripts/go-live.sh` (repo root) prompts for the Resend key, meeting URL and
Turnstile keys, sets the Worker secrets via stdin, writes the Turnstile site
key into both HTML files, commits + pushes, and polls `/health` until
`ready:true`. Blank answers skip a value, so it's safe to run it piecemeal.
Manual equivalent:
```bash
npx wrangler secret put RESEND_API_KEY      # from Resend          ← still needed
npx wrangler secret put TURNSTILE_SECRET    # from Turnstile       ← still needed (optional but recommended)
npx wrangler secret put MEETING_URL         # your reusable video meeting join link  ← still needed
```
`MGMT_TOKEN_SALT` was set on 2026-11-01 (random 32 bytes; a copy is in the
macOS Keychain: `security find-generic-password -s oja-api -a MGMT_TOKEN_SALT -w`).
**Do not change it** once bookings exist — every management link would break.

The API refuses bookings/inquiries with **503 `not-configured`** until
`RESEND_API_KEY` and `MEETING_URL` are set (`/health` → `ready:true` when done).
Secrets take effect immediately; no redeploy needed. For local dev the same
gate is bypassed by `ALLOW_UNCONFIGURED=true` in `.dev.vars` — never set it
in production.
Non-secret config (origins, hours, holidays, rate limits) lives in
`wrangler.toml` `[vars]` — edit there.

### 2.6 Deploy — DONE 2026-11-01 (redeploy after any code change)
```bash
npm run deploy                  # wrangler deploy
```
`wrangler.toml` has `[[routes]] pattern = "api.otakar.dev" custom_domain = true`,
so the deploy binds **api.otakar.dev** and provisions its certificate (the zone
is already on Cloudflare — no DNS migration). The `[triggers] crons` entry
(every 15 min) is enabled automatically — it retries the email outbox and
expires old records.

---

## 3. Post-deploy verification
```bash
# readiness — ready:true and missing:[] once §2.5 is complete
curl -s https://api.otakar.dev/health | jq

# availability (should list weekday Pacific slots)
curl -s "https://api.otakar.dev/availability" | jq '.tz, (.slots|length)'

# a real test booking (use a real inbox you control)
curl -s -X POST https://api.otakar.dev/bookings \
  -H 'Content-Type: application/json' -H 'Origin: https://otakar.dev' \
  -d '{"name":"Test","email":"you@yourmail.com","slot":"<an ISO start from above>"}' | jq
```
Then check: confirmation email arrives with a calendar (`.ics`) attachment
and, if you booked from outside Pacific, your local time on the first line;
the owner notification arrives at `hello@otakar.dev`; the management link opens
`https://otakar.dev/manage.html?token=…` and can reschedule/cancel (the cancel
email carries a `METHOD:CANCEL` invite).

Also run the booking + inquiry flows in a browser on `otakar.dev` and confirm
the Turnstile widget renders.

---

## 4. Operations

**Inspect data** (add `--remote` for production):
```bash
npx wrangler d1 execute oja-booking --remote --command \
  "SELECT slot_start_utc, name, status FROM bookings ORDER BY slot_start_utc"
npx wrangler d1 execute oja-booking --remote --command \
  "SELECT status, COUNT(*) FROM email_outbox GROUP BY status"
```

**Stuck/failed email:** rows in `email_outbox` with `status='failed'` exhausted
their retries — inspect `last_error`. The cron retries `pending` rows with
backoff; sent rows older than 30 days are purged.

**Holidays:** `HOLIDAYS` in `wrangler.toml` is preloaded with US federal
holidays (observed) for **2026–2027**. Add the next year's dates before they
arrive and re-`deploy`.

**Change availability:** edit `BUSINESS_START/END`, `SLOT_MINUTES`,
`BUFFER_MINUTES`, `NOTICE_HOURS`, `HORIZON_DAYS` in `[vars]` and redeploy.

**Reminders:** the cron queues one "see you tomorrow" email per booking once
its start is within `REMINDER_HOURS` (default 24). Set it to `0` to turn
reminders off. Check `SELECT name, slot_start_utc, reminder_sent_at FROM
bookings` to see what has gone out.

**Logs:** `npx wrangler tail`.

**CI:** `.github/workflows/worker-tests.yml` runs `npm test` for `worker/` on
every push/PR touching it. `.github/workflows/deploy-worker.yml` (manual
"Run workflow" button, or `gh workflow run deploy-worker.yml`) runs the tests,
applies remote migrations and deploys. `CLOUDFLARE_ACCOUNT_ID` is already set
on the repo; it only needs `CLOUDFLARE_API_TOKEN` — create one in the
Cloudflare dashboard with Workers Scripts Edit, D1 Edit, Workers Routes Edit
and Zone Read on otakar.dev (the utah-snow CI token has the same shape; tokens
can't be copied between repos), then `gh secret set CLOUDFLARE_API_TOKEN`.
Until then, deploy from this machine with `npm run deploy` (wrangler OAuth).

**Swapping schedulers later:** the front end talks to a provider interface
(`assets/js/scheduler/providers/`). A Cal.com/Calendly move is a new provider
adapter + pointing `window.OJA` at it — no page or Worker changes required.

---

## 5. Rollback
- **Site:** revert the `master` commit and push (Pages redeploys).
- **API:** `npx wrangler rollback` (or `wrangler deploy` a previous commit).
  D1 data is unaffected by a Worker rollback.
