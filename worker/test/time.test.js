import { describe, it, expect } from "vitest";
import { tzOffsetMs, zonedWallClockToUTC, zonedParts } from "../src/time.js";

const TZ = "America/Los_Angeles";

describe("tzOffsetMs — DST aware", () => {
  it("is UTC-8 (PST) in winter", () => {
    expect(tzOffsetMs(TZ, new Date("2026-01-15T20:00:00Z"))).toBe(-8 * 3600000);
  });
  it("is UTC-7 (PDT) in summer", () => {
    expect(tzOffsetMs(TZ, new Date("2026-07-15T20:00:00Z"))).toBe(-7 * 3600000);
  });
});

describe("zonedWallClockToUTC", () => {
  it("maps 10:00 PST to 18:00 UTC in January", () => {
    expect(zonedWallClockToUTC(TZ, 2026, 1, 15, 10, 0).toISOString()).toBe("2026-01-15T18:00:00.000Z");
  });
  it("maps 10:00 PDT to 17:00 UTC in July", () => {
    expect(zonedWallClockToUTC(TZ, 2026, 7, 15, 10, 0).toISOString()).toBe("2026-07-15T17:00:00.000Z");
  });
  it("round-trips across the spring-forward boundary (2026-03-08)", () => {
    // 10:00 wall clock on the DST-change day is unambiguous and already PDT.
    const utc = zonedWallClockToUTC(TZ, 2026, 3, 8, 10, 0);
    const p = zonedParts(TZ, utc);
    expect([p.hour, p.minute]).toEqual([10, 0]);
  });
});

describe("zonedParts", () => {
  it("reports Pacific weekday + date for a UTC instant", () => {
    // 2026-06-19T17:00:00Z = 10:00 PDT on Friday June 19 (Pacific).
    const p = zonedParts(TZ, new Date("2026-06-19T17:00:00Z"));
    expect(p.dateStr).toBe("2026-06-19");
    expect(p.weekday).toBe(5); // Friday
    expect([p.hour, p.minute]).toEqual([10, 0]);
  });
});
