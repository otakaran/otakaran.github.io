// ===========================================================================
// Scheduled work — retry the email outbox, expire stale records, sweep
// rate-limit buckets, and purge old sent mail. Idempotent and cheap.
// ===========================================================================
import { getConfig } from "./config.js";
import { enqueueEmail, flushOutbox, reminderVisitorMessage } from "./email.js";
import { sweepRateLimit } from "./ratelimit.js";
import { reminderWindow } from "./reminders.js";

export async function handleScheduled(env, now = Date.now()) {
  const cfg = getConfig(env);
  const db = env.DB;
  const nowIso = new Date(now).toISOString();
  const results = {};

  // 0. Queue the pre-call reminder for bookings entering the reminder window.
  results.reminders = await queueReminders(db, cfg, now);

  // 1. Retry any pending emails that are due (includes the reminders just queued).
  results.outbox = await flushOutbox(db, cfg, { limit: 50, now });

  // 2. Expire old open inquiries.
  const exp = await db
    .prepare(`UPDATE inquiries SET status='expired' WHERE status='open' AND expires_at < ?`)
    .bind(nowIso)
    .run();
  results.inquiriesExpired = exp.meta?.changes ?? 0;

  // 3. Sweep expired rate-limit buckets.
  await sweepRateLimit(db, now);

  // 4. Purge sent mail older than 30 days (keep the table small).
  await db
    .prepare(`DELETE FROM email_outbox WHERE status='sent' AND created_at < ?`)
    .bind(new Date(now - 30 * 86400000).toISOString())
    .run();

  return results;
}

/** One reminder per booking, marked before it's queued so a retried cron can't double-send. */
export async function queueReminders(db, cfg, now = Date.now()) {
  const w = reminderWindow(cfg, now);
  if (!w.enabled) return 0;
  const due = await db
    .prepare(
      `SELECT * FROM bookings
       WHERE status='booked' AND reminder_sent_at IS NULL
         AND slot_start_utc > ? AND slot_start_utc <= ? AND created_at <= ?
       ORDER BY slot_start_utc ASC LIMIT 50`
    )
    .bind(w.startsAfter, w.startsBefore, w.createdBefore)
    .all();

  let queued = 0;
  for (const row of due.results || []) {
    const mark = await db
      .prepare(`UPDATE bookings SET reminder_sent_at=? WHERE id=? AND reminder_sent_at IS NULL`)
      .bind(new Date(now).toISOString(), row.id)
      .run();
    if ((mark.meta?.changes ?? 0) === 0) continue; // another run got there first
    await enqueueEmail(db, reminderVisitorMessage(cfg, row), now);
    queued++;
  }
  return queued;
}
