import { describe, it, expect } from "vitest";
import { getConfig } from "../src/config.js";
import {
  candidateSlots,
  isBookableSlot,
  slotEnd,
  overlapsWithBuffer,
} from "../src/availability.js";
import { zonedWallClockToUTC, zonedParts } from "../src/time.js";

const HOLIDAYS = "2026-06-19,2026-07-03"; // Juneteenth + Independence (observed)
const cfg = getConfig({ HOLIDAYS });
const TZ = cfg.tz;

// Group candidate slots by their Pacific calendar date.
function byPacificDate(slots) {
  const map = {};
  for (const s of slots) {
    const d = zonedParts(TZ, s).dateStr;
    (map[d] ||= []).push(s);
  }
  return map;
}

describe("candidateSlots", () => {
  const now = new Date("2026-06-15T00:00:00Z");
  const from = now;
  const to = new Date("2026-06-30T00:00:00Z");
  const slots = candidateSlots(cfg, { from, to, now });
  const grouped = byPacificDate(slots);

  it("only generates weekday slots (no Sat/Sun, Pacific)", () => {
    for (const s of slots) {
      const wd = zonedParts(TZ, s).weekday;
      expect(wd).toBeGreaterThanOrEqual(1);
      expect(wd).toBeLessThanOrEqual(5);
    }
  });

  it("excludes configured holidays", () => {
    expect(grouped["2026-06-19"]).toBeUndefined(); // Juneteenth
  });

  it("offers exactly 10 slots on a normal weekday", () => {
    // Wed 2026-06-24 is a plain weekday inside the window.
    expect(grouped["2026-06-24"]).toHaveLength(10);
  });

  it("runs 10:00 → 14:30 Pacific (meeting ends by 15:00)", () => {
    const day = grouped["2026-06-24"].map((s) => {
      const p = zonedParts(TZ, s);
      return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
    });
    expect(day[0]).toBe("10:00");
    expect(day[day.length - 1]).toBe("14:30");
  });

  it("honors the 24h minimum notice", () => {
    const earliest = now.getTime() + cfg.noticeHours * 3600000;
    for (const s of slots) expect(s.getTime()).toBeGreaterThanOrEqual(earliest);
  });

  it("never exceeds the booking horizon", () => {
    const horizon = now.getTime() + cfg.horizonDays * 86400000;
    for (const s of slots) expect(s.getTime()).toBeLessThanOrEqual(horizon);
  });
});

describe("isBookableSlot", () => {
  const now = new Date("2026-06-15T00:00:00Z");
  const wed1000 = zonedWallClockToUTC(TZ, 2026, 6, 24, 10, 0);

  it("accepts a valid grid slot", () => {
    expect(isBookableSlot(cfg, wed1000, now)).toBe(true);
  });
  it("accepts the last slot (14:30, ends 15:00)", () => {
    expect(isBookableSlot(cfg, zonedWallClockToUTC(TZ, 2026, 6, 24, 14, 30), now)).toBe(true);
  });
  it("rejects a slot that would run past close (14:45)", () => {
    expect(isBookableSlot(cfg, zonedWallClockToUTC(TZ, 2026, 6, 24, 14, 45), now)).toBe(false);
  });
  it("rejects off-grid times (10:17)", () => {
    expect(isBookableSlot(cfg, zonedWallClockToUTC(TZ, 2026, 6, 24, 10, 17), now)).toBe(false);
  });
  it("rejects weekends", () => {
    expect(isBookableSlot(cfg, zonedWallClockToUTC(TZ, 2026, 6, 20, 10, 0), now)).toBe(false); // Saturday
  });
  it("rejects holidays", () => {
    expect(isBookableSlot(cfg, zonedWallClockToUTC(TZ, 2026, 6, 19, 10, 0), now)).toBe(false);
  });
  it("rejects slots inside the notice window", () => {
    const soon = zonedWallClockToUTC(TZ, 2026, 6, 24, 10, 0);
    const lateNow = new Date(soon.getTime() - 3600000); // 1h before
    expect(isBookableSlot(cfg, soon, lateNow)).toBe(false);
  });
  it("rejects slots beyond the horizon", () => {
    const far = zonedWallClockToUTC(TZ, 2026, 9, 1, 10, 0);
    expect(isBookableSlot(cfg, far, now)).toBe(false);
  });
});

describe("overlapsWithBuffer", () => {
  const min = 60000;
  const a = [0, 30 * min]; // 30-min meeting at t=0

  it("flags back-to-back meetings (gap 0 < 15)", () => {
    expect(overlapsWithBuffer(a[0], a[1], 30 * min, 60 * min, 15 * min)).toBe(true);
  });
  it("allows a meeting exactly 15 min later", () => {
    expect(overlapsWithBuffer(a[0], a[1], 45 * min, 75 * min, 15 * min)).toBe(false);
  });
  it("allows a well-separated meeting", () => {
    expect(overlapsWithBuffer(a[0], a[1], 120 * min, 150 * min, 15 * min)).toBe(false);
  });
});

describe("slotEnd", () => {
  it("adds the meeting length", () => {
    const start = new Date("2026-06-24T17:00:00Z");
    expect(slotEnd(cfg, start).toISOString()).toBe("2026-06-24T17:30:00.000Z");
  });
});
