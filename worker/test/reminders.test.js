import { describe, it, expect } from "vitest";
import { getConfig } from "../src/config.js";
import { reminderWindow, isReminderDue } from "../src/reminders.js";

const cfg = getConfig({});
const now = Date.parse("2026-06-23T17:00:00Z"); // Tue 10:00 PDT
const H = 3600000;
const base = {
  status: "booked",
  reminder_sent_at: null,
  slot_start_utc: new Date(now + 20 * H).toISOString(), // 20h ahead
  created_at: new Date(now - 30 * H).toISOString(),     // booked yesterday
};

describe("reminderWindow", () => {
  it("spans (now, now + reminderHours] and requires a settled booking", () => {
    const w = reminderWindow(cfg, now);
    expect(w.enabled).toBe(true);
    expect(w.startsAfter).toBe(new Date(now).toISOString());
    expect(w.startsBefore).toBe(new Date(now + 24 * H).toISOString());
    expect(Date.parse(w.createdBefore)).toBeLessThan(now);
  });
  it("is disabled when REMINDER_HOURS is 0", () => {
    expect(reminderWindow(getConfig({ REMINDER_HOURS: "0" }), now).enabled).toBe(false);
  });
});

describe("isReminderDue", () => {
  it("is due inside the window for a settled, active booking", () => {
    expect(isReminderDue(base, cfg, now)).toBe(true);
  });
  it("is not due when the call is further out than reminderHours", () => {
    expect(isReminderDue({ ...base, slot_start_utc: new Date(now + 30 * H).toISOString() }, cfg, now)).toBe(false);
  });
  it("is not due once the call has started", () => {
    expect(isReminderDue({ ...base, slot_start_utc: new Date(now - 1).toISOString() }, cfg, now)).toBe(false);
  });
  it("never double-sends", () => {
    expect(isReminderDue({ ...base, reminder_sent_at: new Date(now - H).toISOString() }, cfg, now)).toBe(false);
  });
  it("skips canceled bookings", () => {
    expect(isReminderDue({ ...base, status: "canceled" }, cfg, now)).toBe(false);
  });
  it("waits an hour after booking so it doesn't chase the confirmation", () => {
    expect(isReminderDue({ ...base, created_at: new Date(now - 10 * 60000).toISOString() }, cfg, now)).toBe(false);
    expect(isReminderDue({ ...base, created_at: new Date(now - 61 * 60000).toISOString() }, cfg, now)).toBe(true);
  });
  it("respects a custom lead time", () => {
    const c2 = getConfig({ REMINDER_HOURS: "2" });
    expect(isReminderDue(base, c2, now)).toBe(false);
    expect(isReminderDue({ ...base, slot_start_utc: new Date(now + 1.5 * H).toISOString() }, c2, now)).toBe(true);
  });
  it("is off entirely when disabled", () => {
    expect(isReminderDue(base, getConfig({ REMINDER_HOURS: "0" }), now)).toBe(false);
  });
});
