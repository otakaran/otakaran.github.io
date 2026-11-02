// ===========================================================================
// Reminder scheduling — pure helpers. A booking gets ONE reminder email once
// its start is within cfg.reminderHours, provided it was created long enough
// ago that the reminder doesn't land right behind the confirmation. The cron
// (every 15 min) asks for due rows with reminderWindow() and marks each one
// with reminder_sent_at so it can never double-send.
// ===========================================================================

const SETTLE_MS = 60 * 60000; // a booking must be ≥1h old before it's reminded

/** Query bounds for "reminder due now" rows (ISO strings for D1). */
export function reminderWindow(cfg, now = Date.now()) {
  const n = typeof now === "number" ? now : now.getTime();
  return {
    enabled: cfg.reminderHours > 0,
    startsAfter: new Date(n).toISOString(),
    startsBefore: new Date(n + cfg.reminderHours * 3600000).toISOString(),
    createdBefore: new Date(n - SETTLE_MS).toISOString(),
  };
}

/** Same rule as reminderWindow(), applied to one booking row (for tests/sanity). */
export function isReminderDue(booking, cfg, now = Date.now()) {
  if (!(cfg.reminderHours > 0)) return false;
  if (booking.status !== "booked" || booking.reminder_sent_at) return false;
  const n = typeof now === "number" ? now : now.getTime();
  const start = Date.parse(booking.slot_start_utc);
  const created = Date.parse(booking.created_at);
  if (!Number.isFinite(start) || !Number.isFinite(created)) return false;
  if (start <= n) return false;                                   // already started/past
  if (start > n + cfg.reminderHours * 3600000) return false;      // not yet in the window
  if (created > n - SETTLE_MS) return false;                      // just booked — confirmation suffices
  return true;
}
