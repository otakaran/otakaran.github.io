-- ===========================================================================
-- OJA booking/contact backend — initial schema.
-- Apply: wrangler d1 migrations apply oja-booking --local   (and --remote)
-- All timestamps are ISO-8601 UTC strings.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS bookings (
  id              TEXT PRIMARY KEY,
  slot_start_utc  TEXT NOT NULL,
  slot_end_utc    TEXT NOT NULL,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  topic           TEXT,
  status          TEXT NOT NULL DEFAULT 'booked',   -- booked | canceled
  mgmt_token_hash TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- Hard double-book guard: at most ONE active booking per start time.
-- Canceled rows keep their start but no longer block rebooking.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_active_slot
  ON bookings (slot_start_utc) WHERE status = 'booked';

CREATE INDEX IF NOT EXISTS idx_bookings_token ON bookings (mgmt_token_hash);
CREATE INDEX IF NOT EXISTS idx_bookings_slot  ON bookings (slot_start_utc);

CREATE TABLE IF NOT EXISTS inquiries (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  project_type TEXT,
  timeline     TEXT,
  budget       TEXT,
  message      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open',         -- open | expired
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries (status, expires_at);

CREATE TABLE IF NOT EXISTS email_outbox (
  id            TEXT PRIMARY KEY,
  to_addr       TEXT NOT NULL,
  subject       TEXT NOT NULL,
  payload_json  TEXT NOT NULL,                        -- {text, html, attachments:[{filename, content(b64)}]}
  attempts      INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT NOT NULL,
  last_error    TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',      -- pending | sent | failed
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending ON email_outbox (status, next_retry_at);

CREATE TABLE IF NOT EXISTS rate_limit (
  bucket_key TEXT PRIMARY KEY,                          -- ip:endpoint:windowIndex
  count      INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_expiry ON rate_limit (expires_at);
