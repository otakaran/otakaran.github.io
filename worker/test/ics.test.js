import { describe, it, expect } from "vitest";
import { buildICS, toBase64 } from "../src/ics.js";

describe("buildICS", () => {
  const ics = buildICS({
    uid: "abc@otakar.dev",
    start: new Date("2026-06-24T17:00:00Z"),
    end: new Date("2026-06-24T17:30:00Z"),
    summary: "Discovery call; with OJA, Inc.",
    description: "Line one\nLine two",
    location: "https://meet.example.com/x",
    organizerEmail: "hello@otakar.dev",
    attendeeEmail: "ada@example.com",
  });

  it("wraps a single VEVENT in a VCALENDAR", () => {
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("END:VCALENDAR");
  });
  it("formats DTSTART/DTEND as UTC basic stamps", () => {
    expect(ics).toContain("DTSTART:20260624T170000Z");
    expect(ics).toContain("DTEND:20260624T173000Z");
  });
  it("escapes commas and semicolons in text", () => {
    expect(ics).toContain("SUMMARY:Discovery call\\; with OJA\\, Inc.");
  });
  it("escapes newlines in the description", () => {
    expect(ics).toContain("DESCRIPTION:Line one\\nLine two");
  });
  it("uses CRLF line endings", () => {
    expect(ics).toContain("\r\n");
  });
});

describe("toBase64", () => {
  it("round-trips through atob", () => {
    expect(atob(toBase64("hello"))).toBe("hello");
  });
});
