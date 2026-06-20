# OJA API — booking & contact backend

Cloudflare Worker + D1 (+ Resend email, Cloudflare Turnstile) powering the
self-booking and project-inquiry flows on **otakar.dev**. Serves
**api.otakar.dev**. Not part of the GitHub Pages site.

For end-to-end **deployment**, see [`../DEPLOY.md`](../DEPLOY.md). This file is
the developer reference.

## Endpoints
| Method | Path | Purpose |
| --- | --- | --- |
| GET  | `/availability?from&to` | open 30-min slots (weekday 10:00–15:00 PT, DST-aware) |
| POST | `/bookings` | create a booking → confirmation + ICS email |
| GET  | `/bookings/:token` | look up a booking (manage page) |
| POST | `/bookings/:token/reschedule` | move a booking |
| POST | `/bookings/:token/cancel` | cancel a booking |
| POST | `/inquiries` | project inquiry → owner notify + auto-reply |
| GET  | `/health` | liveness |
| —    | `scheduled()` | cron: retry email outbox, expire records, sweep |

## Booking rules (configurable in `wrangler.toml [vars]`)
Weekdays only, **10:00 AM–3:00 PM Pacific** (DST via `Intl`), 30-min slots,
15-min buffers between calls, ≥24h notice, 45-day horizon. US federal holidays
(observed, 2026–2027) are excluded via the `HOLIDAYS` list. All times stored
UTC. A partial unique index `(slot_start_utc) WHERE status='booked'` is the
hard double-book guard → conflicting writes return **409**.

## Anti-abuse
Turnstile (server-verified; skipped when no secret in dev), honeypot field,
strict length/format validation, per-IP fixed-window rate limit (D1), and an
origin allow-list (`ALLOWED_ORIGIN`). Management tokens are stored only as a
salted SHA-256 hash; the raw token lives in the email link.

## Layout
```
src/
  index.js        router + scheduled() — CORS, rate limit, Turnstile, honeypot, dispatch
  config.js       env → typed config with defaults
  time.js         Intl-based tz helpers (offset, wall-clock→UTC, parts)  [pure]
  availability.js slot grid, isBookableSlot, buffer overlap             [pure]
  booking.js      availability query + create/reschedule/cancel/lookup
  inquiries.js    inquiry create
  email.js        templates + Resend send + durable outbox
  ics.js          RFC-5545 VEVENT builder                                [pure]
  tokens.js       token gen + salted hashing
  validation.js   field validation + honeypot                           [pure]
  turnstile.js    Turnstile siteverify
  ratelimit.js    per-IP fixed-window (D1)
  cron.js         outbox retry + expiry + sweep
migrations/0001_init.sql
test/             vitest unit tests for the pure core
```

## Local development
```bash
npm install
cp .dev.vars.example .dev.vars        # fill in / leave blank for safe dev mode
npm run db:migrate:local              # apply schema to local D1
npm run dev                           # wrangler dev on http://127.0.0.1:8787
```
In dev mode with blank secrets: emails stay queued in `email_outbox` (never
sent), and Turnstile verification is skipped. Set `ALLOWED_ORIGIN=*` in
`.dev.vars` to call the dev API from a locally-served page (e.g.
`index.html?api=http://127.0.0.1:8787` — the `?api=` override is honored only
for localhost).

## Tests
```bash
npm test           # vitest: DST/slot/holiday, tokens, validation, ICS (48 assertions)
```
The pure algorithmic core is unit-tested in Node. DB/HTTP behaviour
(availability filtering, double-book 409, reschedule/cancel, inquiries,
honeypot, CORS) is verified against `wrangler dev` — there's a smoke script
pattern in `DEPLOY.md` §3.

## Inspect local data
```bash
npx wrangler d1 execute oja-booking --local --command "SELECT * FROM bookings"
npx wrangler d1 execute oja-booking --local --command "SELECT to_addr, subject, status FROM email_outbox"
```
