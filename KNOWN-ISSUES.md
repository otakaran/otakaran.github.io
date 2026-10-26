# OJA Solutions — Known Issues, Bugs & Concerns

Engineering risk register for the booking/contact system (scheduler UI +
Cloudflare Worker backend), as of the P2–P5 build. None of these block launch;
they are the things a future maintainer (human or agent) should know. Severity:
**[high]** address before/at launch · **[med]** plan to fix · **[low]** note.

Cross-reference: design/spec in the plan and `HANDOFF.md`; deploy steps in
`DEPLOY.md`; backend reference in `worker/README.md`; UI/content nits in
`private/review-findings.md`.

---

## Deployment must-dos (do these or the system is degraded)

- **[high] Set `TURNSTILE_SECRET` in production.** If it's unset, the Worker
  *skips* Turnstile verification by design (so dev works without keys). In prod
  that means bookings/inquiries have **no bot challenge** — only the honeypot +
  per-IP rate limit. Set the secret and put the matching site key in
  `window.OJA.turnstileSiteKey` (`index.html` + `manage.html`).
- ~~**[high] Replace `database_id` in `worker/wrangler.toml`.**~~ Done
  2026-10-25: `oja-booking` created and migrated; id is in `wrangler.toml`.
- **[high] Verify the Resend domain + that `hello@otakar.dev` can receive.**
  `RESEND_FROM` must be on a verified domain or all mail silently fails into the
  outbox; `hello@otakar.dev` is the owner-notify + reply-to inbox.
- **[med] Set a strong `MGMT_TOKEN_SALT`.** Default is a dev placeholder. If it
  changes after bookings exist, all existing management links break (tokens are
  matched by salted hash).
- **[med] `MEETING_URL` is one fixed link for every booking** (see Product
  limitations). Set it to a real, reusable room.

## Security / anti-abuse

- **[med] Single fixed meeting URL is shared + disclosed.** Every confirmed
  booking returns and emails the same `MEETING_URL`. Anyone who completes a
  booking learns the room link; back-to-back (buffered) calls share the room.
  Fine for a discovery-call funnel; revisit if you need per-meeting links
  (would require a Google Meet/Zoom API integration — a new email/booking step).
- **[med] Origin allow-list intentionally permits requests with *no* `Origin`
  header** (curl/server-to-server) and only rejects a *present, mismatched*
  browser origin (→403). CSRF isn't a concern (no cookies/sessions), but it
  means non-browser clients can POST; abuse is gated by Turnstile + rate limit +
  honeypot, not by origin. If you want stricter, require `Origin` for POSTs in
  `src/http.js → originAllowed`.
- **[low] Inquiry auto-reply is a (small) spam-amplification vector.** A
  submission with a victim's email triggers one auto-reply to that address.
  Mitigated by Turnstile + the per-IP rate limit; acceptable at this volume.
- **[low] Worker source is committed to the public Pages repo** and is fetchable
  as static text (e.g. `otakar.dev/worker/src/index.js`). It contains **no
  secrets** (all via `wrangler secret`), and `robots.txt` now disallows
  `/worker/`. If you'd rather not expose backend logic at all, move `worker/`
  to its own private repo (it's already self-contained — not used by Pages).

## Correctness / edge cases

- **[med] Booking-buffer enforcement is best-effort under concurrency.** The
  hard guard (partial unique index on `slot_start_utc WHERE status='booked'`)
  prevents two bookings at the *exact same* start (→409, tested). The 15-minute
  *buffer* between adjacent slots is enforced by a read-then-write check
  (`hasBufferConflict`), which is **not atomic** — two simultaneous bookings 30
  min apart could in theory both succeed despite the buffer intent. Extremely
  unlikely at this traffic; if it matters, move the buffer check into a D1
  transaction/batch or widen the unique constraint.
- **[med] Rate limit is a fixed window, not a sliding one.** Up to `2×RATE_MAX`
  requests can pass across a window boundary, and the upsert+select isn't fully
  atomic. Good enough for abuse-deterrence on a personal site; not a precise
  quota. Tune `RATE_MAX` / `RATE_WINDOW_SECONDS` in `wrangler.toml`.
- **[med] `HOLIDAYS` is hardcoded through 2027-12-24.** With a 45-day horizon,
  2028 holidays start mattering around **mid-November 2027** — extend the list
  in `wrangler.toml` and redeploy before then, or those days will (wrongly)
  show slots.
- **[low] Cancel email has no cancellation `.ics`.** Confirm/reschedule attach a
  calendar invite (VEVENT); cancel sends a text/HTML notice only, so the event
  isn't auto-removed from the attendee's calendar. Add a `METHOD:CANCEL` ICS to
  `cancelVisitorMessage` if you want auto-removal.
- **[low] Availability returns the full 45-day horizon in one response**
  (~300 slots / ~30 KB). No pagination. Fine at this size.

## Accessibility

- **[med] The scheduler root carries `aria-live="polite"` and re-renders
  wholesale on each interaction.** Screen readers may re-announce the whole
  picker on every click — chatty. Recommended: drop the root live region and
  keep live announcements scoped to the `.sched__status` region + a dedicated
  "selected"/"booked" announcement. (Left as-is because the current build is
  verified working; this is an untested change.)
- **[low] Day rail is `role="tablist"` but without full ARIA tab semantics**
  (no `aria-controls`/tabpanel, no arrow-key roving tabindex). Chips and time
  buttons are native `<button>`s, so they're focusable and operable with
  Enter/Space; only the tablist arrow-key convention is missing.
- **[low] A11Y-02 (carried):** mock `<img alt>` vs the SVGs' inner `aria-label`
  differ in wording (no double-announce since used via `<img>`).

## Testing gaps

- **[med] No automated tests for the HTTP/handler layer.** `npm test` covers the
  pure core (DST, slot grid, holidays, tokens, validation, ICS — 48 assertions).
  Routing, rate limiting, CORS, double-book 409, reschedule/cancel, inquiries,
  and honeypot are covered only by the **manual** `wrangler dev` integration
  pass (17 checks, see `DEPLOY.md`) and Playwright E2E — not in CI. Consider
  `@cloudflare/vitest-pool-workers` to test handlers against Miniflare D1.
- **[low] No CI configured.** Tests are run manually.

## Product / UX limitations

- **[low] Times shown in Pacific only.** Slots render as e.g. "10:00 AM PDT";
  out-of-zone visitors must convert mentally. A "show in my timezone" toggle
  would be a nice enhancement.
- **[low] `MockProvider` exists for offline demos.** It only activates with
  `data-provider="mock"`; a misconfiguration there would simulate non-persistent
  bookings. Default is the real `WorkerProvider`.

## Carried-over frontend/content items (not from this build)

- **Launch gate — 7 invented `data-draft="invented"` artifacts** must be grounded
  or removed before merging to `master` (`grep -rn 'data-draft' index.html`).
- **CONTENT-01** proj-01 screenshot has internal/operator text (owner decision).
- **MOTIF-01 / UI-02 / CONTENT-03** minor cosmetic nits — see
  `private/review-findings.md`.
