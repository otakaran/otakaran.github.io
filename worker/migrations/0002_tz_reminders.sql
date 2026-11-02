-- ===========================================================================
-- Visitor time zone + reminder bookkeeping.
--   tz               IANA zone the visitor booked in (optional); used to show
--                    their local time in emails alongside Pacific.
--   reminder_sent_at set by the cron once the pre-call reminder is queued.
-- Apply: wrangler d1 migrations apply oja-booking --local   (and --remote)
-- ===========================================================================

ALTER TABLE bookings ADD COLUMN tz TEXT;
ALTER TABLE bookings ADD COLUMN reminder_sent_at TEXT;

CREATE INDEX IF NOT EXISTS idx_bookings_reminder
  ON bookings (status, reminder_sent_at, slot_start_utc);
