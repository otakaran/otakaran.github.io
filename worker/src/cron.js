// ===========================================================================
// Scheduled work — retry the email outbox, expire stale records, sweep
// rate-limit buckets, and purge old sent mail. Idempotent and cheap.
// ===========================================================================
import { getConfig } from "./config.js";
import { flushOutbox } from "./email.js";
import { sweepRateLimit } from "./ratelimit.js";

export async function handleScheduled(env, now = Date.now()) {
  const cfg = getConfig(env);
  const db = env.DB;
  const nowIso = new Date(now).toISOString();
  const results = {};

  // 1. Retry any pending emails that are due.
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
