// ===========================================================================
// Timezone helpers — pure, built on Intl. No external deps.
// All business hours are expressed as wall-clock time in a named tz
// (America/Los_Angeles); everything is stored and compared in UTC.
// ===========================================================================

/**
 * Offset in ms such that:  localWallClockMillis = utcMillis + offset.
 * Negative for the US Pacific zone (UTC-7 / UTC-8). DST-aware: resolved at the
 * given instant, so it returns -7h in summer (PDT) and -8h in winter (PST).
 */
export function tzOffsetMs(timeZone, date) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const f = {};
  for (const p of dtf.formatToParts(date)) if (p.type !== "literal") f[p.type] = p.value;
  const asUTC = Date.UTC(+f.year, +f.month - 1, +f.day, +f.hour, +f.minute, +f.second);
  return asUTC - date.getTime();
}

/**
 * Convert a wall-clock time in `timeZone` (y, 1-based mo, d, h, mi) to the
 * matching UTC Date. Re-resolves the offset once so instants that land on the
 * far side of a DST transition still map correctly.
 */
export function zonedWallClockToUTC(timeZone, y, mo, d, h, mi) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = tzOffsetMs(timeZone, new Date(guess));
  let utc = guess - off1;
  const off2 = tzOffsetMs(timeZone, new Date(utc));
  if (off2 !== off1) utc = guess - off2;
  return new Date(utc);
}

const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Calendar/clock parts for a UTC instant rendered in `timeZone`.
 * weekday: 0=Sun … 6=Sat. dateStr: "YYYY-MM-DD" in that tz.
 */
export function zonedParts(timeZone, date) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
  const f = {};
  for (const p of dtf.formatToParts(date)) if (p.type !== "literal") f[p.type] = p.value;
  return {
    year: +f.year,
    month: +f.month,
    day: +f.day,
    hour: +f.hour,
    minute: +f.minute,
    weekday: WEEKDAY[f.weekday],
    dateStr: `${f.year}-${f.month}-${f.day}`,
  };
}
