// ===========================================================================
// Per-IP fixed-window rate limit, stored in D1. Cheap, atomic-enough via an
// UPSERT increment. Expired buckets are swept by the cron job.
// ===========================================================================

/**
 * Returns { allowed, count, limit, retryAfter }. Counts this request.
 * key is typically `${ip}:${endpoint}`.
 */
export async function rateLimit(db, key, { max, windowSeconds, now = Date.now() }) {
  const windowIndex = Math.floor(now / 1000 / windowSeconds);
  const bucketKey = `${key}:${windowIndex}`;
  const expiresAt = new Date((windowIndex + 1) * windowSeconds * 1000).toISOString();

  await db
    .prepare(
      `INSERT INTO rate_limit (bucket_key, count, expires_at) VALUES (?, 1, ?)
       ON CONFLICT(bucket_key) DO UPDATE SET count = count + 1`
    )
    .bind(bucketKey, expiresAt)
    .run();

  const row = await db
    .prepare(`SELECT count FROM rate_limit WHERE bucket_key = ?`)
    .bind(bucketKey)
    .first();

  const count = row ? row.count : 1;
  const allowed = count <= max;
  const retryAfter = allowed ? 0 : (windowIndex + 1) * windowSeconds - Math.floor(now / 1000);
  return { allowed, count, limit: max, retryAfter };
}

/** Delete expired rate-limit buckets (called from cron). */
export async function sweepRateLimit(db, now = Date.now()) {
  await db
    .prepare(`DELETE FROM rate_limit WHERE expires_at < ?`)
    .bind(new Date(now).toISOString())
    .run();
}
