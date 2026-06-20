// ===========================================================================
// Availability engine — pure functions (no DB, no env globals).
// Generates the candidate slot grid; booking.js filters it against the DB.
// ===========================================================================
import { zonedWallClockToUTC, zonedParts } from "./time.js";

const pad2 = (n) => String(n).padStart(2, "0");
const pad4 = (n) => String(n).padStart(4, "0");

function parseHM(s) {
  const [h, m] = String(s).split(":").map(Number);
  return { h: h || 0, m: m || 0 };
}

/**
 * All bookable 30-min slot starts (UTC Date[]) over [from, to], honoring:
 *  - business hours (cfg.businessStart..End wall-clock in cfg.tz), meeting must end by close
 *  - weekdays only (Pacific Mon–Fri)
 *  - holiday exclusion (cfg.holidays: Set<"YYYY-MM-DD">)
 *  - minimum notice (cfg.noticeHours) and booking horizon (cfg.horizonDays)
 * Does NOT consult existing bookings — booking.js removes taken/buffered slots.
 */
export function candidateSlots(cfg, { from, to, now }) {
  const { h: sh, m: sm } = parseHM(cfg.businessStart);
  const { h: eh, m: em } = parseHM(cfg.businessEnd);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const step = cfg.slotMinutes;
  const meeting = cfg.meetingMinutes;

  const earliest = now.getTime() + cfg.noticeHours * 3600000;
  const horizon = now.getTime() + cfg.horizonDays * 86400000;
  const lo = Math.max(from.getTime(), now.getTime());
  const hi = Math.min(to.getTime(), horizon);
  if (lo > hi) return [];

  const out = [];
  // Calendar-date counter in the business tz. The UTC Date below is used purely
  // as a Y-M-D counter (correct month/year rollover), never as an instant.
  const seed = zonedParts(cfg.tz, new Date(lo));
  const cal = new Date(Date.UTC(seed.year, seed.month - 1, seed.day));
  cal.setUTCDate(cal.getUTCDate() - 1); // pad one day back for the boundary
  const days = cfg.horizonDays + 3;

  for (let i = 0; i < days; i++) {
    const y = cal.getUTCFullYear();
    const mo = cal.getUTCMonth() + 1;
    const d = cal.getUTCDate();
    cal.setUTCDate(cal.getUTCDate() + 1);

    const dateStr = `${pad4(y)}-${pad2(mo)}-${pad2(d)}`;
    // Use noon to read the weekday — avoids any midnight DST-transition edge.
    const wd = zonedParts(cfg.tz, zonedWallClockToUTC(cfg.tz, y, mo, d, 12, 0)).weekday;
    if (wd === 0 || wd === 6) continue;
    if (cfg.holidays.has(dateStr)) continue;

    for (let t = startMin; t + meeting <= endMin; t += step) {
      const slotStart = zonedWallClockToUTC(cfg.tz, y, mo, d, Math.floor(t / 60), t % 60);
      const ms = slotStart.getTime();
      if (ms < lo || ms > hi || ms < earliest) continue;
      out.push(slotStart);
    }
  }
  out.sort((a, b) => a - b);
  return out;
}

/**
 * Whether a specific slot start is a legitimate bookable grid slot right now:
 * on the grid, inside hours, a weekday, not a holiday, within notice + horizon.
 */
export function isBookableSlot(cfg, slotStart, now) {
  const t = slotStart.getTime();
  if (Number.isNaN(t)) return false;
  if (t < now.getTime() + cfg.noticeHours * 3600000) return false;
  if (t > now.getTime() + cfg.horizonDays * 86400000) return false;

  const p = zonedParts(cfg.tz, slotStart);
  if (p.weekday === 0 || p.weekday === 6) return false;
  if (cfg.holidays.has(p.dateStr)) return false;

  const { h: sh, m: sm } = parseHM(cfg.businessStart);
  const { h: eh, m: em } = parseHM(cfg.businessEnd);
  const minutes = p.hour * 60 + p.minute;
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (minutes < startMin) return false;
  if (minutes + cfg.meetingMinutes > endMin) return false;
  if ((minutes - startMin) % cfg.slotMinutes !== 0) return false;

  // Reject anything that doesn't round-trip to an exact grid instant (e.g. :17,
  // or a UTC value nudged off the grid by a DST artifact).
  const rebuilt = zonedWallClockToUTC(cfg.tz, p.year, p.month, p.day, p.hour, p.minute);
  return rebuilt.getTime() === t;
}

/** End of a meeting that starts at slotStart (Date). */
export function slotEnd(cfg, slotStart) {
  return new Date(slotStart.getTime() + cfg.meetingMinutes * 60000);
}

/**
 * Do meetings [aStart,aEnd) and [bStart,bEnd) conflict once a buffer is applied?
 * They conflict unless separated by at least `bufferMs` on both sides.
 * All args are epoch ms.
 */
export function overlapsWithBuffer(aStart, aEnd, bStart, bEnd, bufferMs) {
  return aStart < bEnd + bufferMs && bStart < aEnd + bufferMs;
}
