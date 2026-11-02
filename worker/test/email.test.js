import { describe, it, expect } from "vitest";
import { getConfig } from "../src/config.js";
import {
  visitorWhen,
  bookingVisitorMessage,
  cancelVisitorMessage,
  reminderVisitorMessage,
  bookingOwnerMessage,
} from "../src/email.js";

const cfg = getConfig({ MEETING_URL: "https://meet.example.com/oja" });
const booking = {
  id: "bk_1",
  slot_start_utc: "2026-06-24T17:00:00.000Z", // 10:00 PDT
  slot_end_utc: "2026-06-24T17:30:00.000Z",
  name: "Ada",
  email: "ada@example.com",
  topic: "Jira sync",
  tz: "Europe/Prague",
};

describe("visitorWhen", () => {
  it("leads with the visitor's local time and keeps Pacific as the second line", () => {
    const w = visitorWhen(cfg, booking);
    expect(w.primary).toMatch(/7:00 PM GMT\+2 \(your time\)|7:00 PM CEST \(your time\)/);
    expect(w.secondary).toMatch(/10:00 AM PDT \(Pacific\)/);
  });
  it("shows only Pacific when no zone was recorded", () => {
    const w = visitorWhen(cfg, { ...booking, tz: null });
    expect(w.primary).toMatch(/10:00 AM PDT/);
    expect(w.secondary).toBe("");
  });
  it("collapses zones that share Pacific's clock", () => {
    const w = visitorWhen(cfg, { ...booking, tz: "America/Vancouver" });
    expect(w.secondary).toBe("");
  });
  it("ignores a bogus zone instead of throwing", () => {
    const w = visitorWhen(cfg, { ...booking, tz: "Mars/Olympus" });
    expect(w.secondary).toBe("");
  });
});

describe("templates", () => {
  it("confirmation carries both times and the calendar attachment", () => {
    const m = bookingVisitorMessage(cfg, booking, "https://otakar.dev/manage.html?token=t");
    expect(m.text).toContain("(your time)");
    expect(m.text).toContain("(Pacific)");
    expect(m.text).toContain("reminder the day before");
    expect(m.icsContent).toContain("METHOD:REQUEST");
  });
  it("owner notice names the visitor's zone", () => {
    const m = bookingOwnerMessage(cfg, booking);
    expect(m.text).toContain("Europe/Prague");
  });
  it("cancellation attaches a METHOD:CANCEL invite with the same UID", () => {
    const m = cancelVisitorMessage(cfg, booking);
    expect(m.icsContent).toContain("METHOD:CANCEL");
    expect(m.icsContent).toContain("STATUS:CANCELLED");
    expect(m.icsContent).toContain("UID:bk_1@otakar.dev");
  });
  it("reminder says 'tomorrow' for a 24h lead and includes the join link", () => {
    const m = reminderVisitorMessage(cfg, booking);
    expect(m.subject).toContain("tomorrow");
    expect(m.text).toContain("https://meet.example.com/oja");
    expect(m.text).toContain("Jira sync");
  });
});
