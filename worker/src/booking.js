// ===========================================================================
// Booking handlers — availability, create, lookup, reschedule, cancel.
// Each returns { status, body }; index.js wraps it in a CORS JSON response and
// flushes the email outbox via ctx.waitUntil. The partial unique index on
// (slot_start_utc) WHERE status='booked' is the hard double-book guard (->409).
// ===========================================================================
import { candidateSlots, isBookableSlot, slotEnd, overlapsWithBuffer } from "./availability.js";
import { newId, newToken, hashToken } from "./tokens.js";
import { validateBooking, validateReschedule } from "./validation.js";
import * as email from "./email.js";

const isUniqueErr = (err) => /UNIQUE|constraint/i.test(String(err && (err.message || err)));

async function activeBookingsBetween(db, startMs, endMs) {
  const rows = await db
    .prepare(
      `SELECT id, slot_start_utc, slot_end_utc FROM bookings
       WHERE status='booked' AND slot_start_utc >= ? AND slot_start_utc <= ?`
    )
    .bind(new Date(startMs).toISOString(), new Date(endMs).toISOString())
    .all();
  return rows.results || [];
}

export async function getAvailability(db, cfg, { from, to, now = new Date() }) {
  const candidates = candidateSlots(cfg, { from, to, now });
  if (candidates.length === 0) return { status: 200, body: { tz: cfg.tz, slots: [] } };

  const meetingMs = cfg.meetingMinutes * 60000;
  const bufferMs = cfg.bufferMinutes * 60000;
  const pad = bufferMs + meetingMs;
  const first = candidates[0].getTime();
  const last = candidates[candidates.length - 1].getTime();

  const taken = (await activeBookingsBetween(db, first - pad, last + pad)).map((r) => ({
    s: Date.parse(r.slot_start_utc),
    e: Date.parse(r.slot_end_utc),
  }));

  const slots = candidates
    .filter((c) => {
      const s = c.getTime();
      const e = s + meetingMs;
      return !taken.some((t) => overlapsWithBuffer(s, e, t.s, t.e, bufferMs));
    })
    .map((c) => ({
      start: c.toISOString(),
      end: new Date(c.getTime() + meetingMs).toISOString(),
    }));

  return { status: 200, body: { tz: cfg.tz, slots } };
}

async function hasBufferConflict(db, cfg, start, end, excludeId = null) {
  const bufferMs = cfg.bufferMinutes * 60000;
  const pad = bufferMs + cfg.meetingMinutes * 60000;
  const near = await activeBookingsBetween(db, start.getTime() - pad, start.getTime() + pad);
  return near.some(
    (r) =>
      r.id !== excludeId &&
      overlapsWithBuffer(
        start.getTime(),
        end.getTime(),
        Date.parse(r.slot_start_utc),
        Date.parse(r.slot_end_utc),
        bufferMs
      )
  );
}

export async function createBooking(db, cfg, body, now = new Date()) {
  const v = validateBooking(body);
  if (!v.ok) return { status: 400, body: { error: "validation", fields: v.errors } };
  const { name, email: visitorEmail, topic, slot } = v.clean;

  const start = new Date(slot);
  if (!isBookableSlot(cfg, start, now)) {
    return { status: 422, body: { error: "slot-unavailable", message: "That time isn't available — please pick another." } };
  }
  const end = slotEnd(cfg, start);

  if (await hasBufferConflict(db, cfg, start, end)) {
    return { status: 409, body: { error: "slot-taken", message: "That time was just taken — please pick another." } };
  }

  const id = newId();
  const rawToken = newToken();
  const tokenHash = await hashToken(rawToken, cfg.mgmtTokenSalt);
  const nowIso = now.toISOString();
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  try {
    await db
      .prepare(
        `INSERT INTO bookings
           (id, slot_start_utc, slot_end_utc, name, email, topic, status, mgmt_token_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'booked', ?, ?, ?)`
      )
      .bind(id, startIso, endIso, name, visitorEmail, topic, tokenHash, nowIso, nowIso)
      .run();
  } catch (err) {
    if (isUniqueErr(err)) {
      return { status: 409, body: { error: "slot-taken", message: "That time was just taken — please pick another." } };
    }
    throw err;
  }

  const booking = { id, slot_start_utc: startIso, slot_end_utc: endIso, name, email: visitorEmail, topic };
  const manageUrl = `${cfg.siteOrigin}/manage.html?token=${encodeURIComponent(rawToken)}`;
  await email.enqueueEmail(db, email.bookingVisitorMessage(cfg, booking, manageUrl));
  await email.enqueueEmail(db, email.bookingOwnerMessage(cfg, booking));

  return {
    status: 201,
    body: {
      ok: true,
      booking: { start: startIso, end: endIso, name, email: visitorEmail },
      manage_token: rawToken,
      manage_url: manageUrl,
      meeting_url: cfg.meetingUrl,
    },
  };
}

export async function getBooking(db, cfg, token) {
  const hash = await hashToken(token, cfg.mgmtTokenSalt);
  const row = await db
    .prepare(`SELECT slot_start_utc, slot_end_utc, name, status FROM bookings WHERE mgmt_token_hash=?`)
    .bind(hash)
    .first();
  if (!row) return { status: 404, body: { error: "not-found", message: "We couldn't find that booking." } };
  return {
    status: 200,
    body: {
      booking: {
        start: row.slot_start_utc,
        end: row.slot_end_utc,
        name: row.name,
        status: row.status,
        meeting_url: row.status === "booked" ? cfg.meetingUrl : null,
      },
    },
  };
}

export async function rescheduleBooking(db, cfg, token, body, now = new Date()) {
  const v = validateReschedule(body);
  if (!v.ok) return { status: 400, body: { error: "validation", fields: v.errors } };

  const start = new Date(v.clean.slot);
  if (!isBookableSlot(cfg, start, now)) {
    return { status: 422, body: { error: "slot-unavailable", message: "That time isn't available — please pick another." } };
  }

  const hash = await hashToken(token, cfg.mgmtTokenSalt);
  const existing = await db
    .prepare(`SELECT * FROM bookings WHERE mgmt_token_hash=? AND status='booked'`)
    .bind(hash)
    .first();
  if (!existing) {
    return { status: 404, body: { error: "not-found", message: "We couldn't find an active booking for that link." } };
  }

  const end = slotEnd(cfg, start);
  if (await hasBufferConflict(db, cfg, start, end, existing.id)) {
    return { status: 409, body: { error: "slot-taken", message: "That time was just taken — please pick another." } };
  }

  const prevStart = existing.slot_start_utc;
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  try {
    await db
      .prepare(`UPDATE bookings SET slot_start_utc=?, slot_end_utc=?, updated_at=? WHERE id=?`)
      .bind(startIso, endIso, now.toISOString(), existing.id)
      .run();
  } catch (err) {
    if (isUniqueErr(err)) {
      return { status: 409, body: { error: "slot-taken", message: "That time was just taken — please pick another." } };
    }
    throw err;
  }

  const booking = { ...existing, slot_start_utc: startIso, slot_end_utc: endIso };
  const manageUrl = `${cfg.siteOrigin}/manage.html?token=${encodeURIComponent(token)}`;
  await email.enqueueEmail(db, email.rescheduleVisitorMessage(cfg, booking, prevStart, manageUrl));
  await email.enqueueEmail(db, email.rescheduleOwnerMessage(cfg, booking, prevStart));

  return { status: 200, body: { ok: true, booking: { start: startIso, end: endIso } } };
}

export async function cancelBooking(db, cfg, token, now = new Date()) {
  const hash = await hashToken(token, cfg.mgmtTokenSalt);
  const existing = await db
    .prepare(`SELECT * FROM bookings WHERE mgmt_token_hash=? AND status='booked'`)
    .bind(hash)
    .first();
  if (!existing) {
    return { status: 404, body: { error: "not-found", message: "We couldn't find an active booking for that link." } };
  }

  await db
    .prepare(`UPDATE bookings SET status='canceled', updated_at=? WHERE id=?`)
    .bind(now.toISOString(), existing.id)
    .run();

  await email.enqueueEmail(db, email.cancelVisitorMessage(cfg, existing));
  await email.enqueueEmail(db, email.cancelOwnerMessage(cfg, existing));

  return { status: 200, body: { ok: true } };
}
