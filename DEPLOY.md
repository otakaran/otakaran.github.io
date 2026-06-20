# OJA Solutions — Deployment Runbook

Two independently-deployed parts:

| Part | Where it runs | How it deploys |
| --- | --- | --- |
| **Site** (`index.html`, `manage.html`, `assets/`) | GitHub Pages → `otakar.dev` | push to `master` (Pages serves repo root) |
| **API** (`worker/`) | Cloudflare Worker + D1 → `api.otakar.dev` | `wrangler deploy` |

The site calls the API from the browser; the two share no build step. The API
is **free-tier only** (Workers + D1 + Resend free limits; paid overages off).

> ⚠️ **Launch gate first.** Do not merge to `master` until the 7 invented
> placeholders are grounded or removed: `grep -rn 'data-draft' index.html`
> (see `HANDOFF.md` → "Invented content to ground"). GitHub Pages serves
> `master`, so merging = going live.

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

## 2. Backend (Cloudflare Worker + D1 + Resend + Turnstile)

Prereqs: a Cloudflare account (the `otakar.dev` zone already lives there), a
Resend account, Node 20+, and `cd worker && npm install`.

### 2.1 Log in & create the database
```bash
cd worker
npx wrangler login
npx wrangler d1 create oja-booking
```
Copy the returned `database_id` into `wrangler.toml` (replace
`REPLACE_WITH_D1_DATABASE_ID`).

### 2.2 Apply the schema
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

### 2.5 Set secrets
```bash
npx wrangler secret put RESEND_API_KEY      # from Resend
npx wrangler secret put TURNSTILE_SECRET    # from Turnstile
npx wrangler secret put MGMT_TOKEN_SALT     # a long random string (e.g. openssl rand -hex 32)
npx wrangler secret put MEETING_URL         # your private video meeting join link
```
Non-secret config (origins, hours, holidays, rate limits) lives in
`wrangler.toml` `[vars]` — edit there.

### 2.6 Deploy
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
# availability (should list weekday Pacific slots)
curl -s "https://api.otakar.dev/availability" | jq '.tz, (.slots|length)'

# a real test booking (use a real inbox you control)
curl -s -X POST https://api.otakar.dev/bookings \
  -H 'Content-Type: application/json' -H 'Origin: https://otakar.dev' \
  -d '{"name":"Test","email":"you@yourmail.com","slot":"<an ISO start from above>"}' | jq
```
Then check: confirmation email arrives with a calendar (`.ics`) attachment;
the owner notification arrives at `hello@otakar.dev`; the management link opens
`https://otakar.dev/manage.html?token=…` and can reschedule/cancel.

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

**Logs:** `npx wrangler tail`.

**Swapping schedulers later:** the front end talks to a provider interface
(`assets/js/scheduler/providers/`). A Cal.com/Calendly move is a new provider
adapter + pointing `window.OJA` at it — no page or Worker changes required.

---

## 5. Rollback
- **Site:** revert the `master` commit and push (Pages redeploys).
- **API:** `npx wrangler rollback` (or `wrangler deploy` a previous commit).
  D1 data is unaffected by a Worker rollback.
