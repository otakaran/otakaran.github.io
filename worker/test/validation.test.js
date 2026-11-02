import { describe, it, expect } from "vitest";
import {
  validateBooking,
  validateReschedule,
  validateInquiry,
  honeypotTripped,
  isIsoInstant,
} from "../src/validation.js";

describe("validateBooking", () => {
  const good = { name: "Ada", email: "ada@example.com", slot: "2026-06-24T17:00:00.000Z", topic: "AI" };

  it("accepts a complete payload", () => {
    expect(validateBooking(good).ok).toBe(true);
  });
  it("rejects a missing name", () => {
    expect(validateBooking({ ...good, name: "  " }).ok).toBe(false);
  });
  it("rejects a bad email", () => {
    const r = validateBooking({ ...good, email: "nope" });
    expect(r.ok).toBe(false);
    expect(r.errors.email).toBeTruthy();
  });
  it("rejects a non-ISO slot", () => {
    expect(validateBooking({ ...good, slot: "tomorrow" }).ok).toBe(false);
  });
  it("clamps over-long fields", () => {
    const r = validateBooking({ ...good, name: "x".repeat(500) });
    expect(r.clean.name.length).toBe(100);
  });
  it("keeps a valid IANA time zone", () => {
    expect(validateBooking({ ...good, tz: "Europe/Prague" }).clean.tz).toBe("Europe/Prague");
  });
  it("drops an invalid time zone without failing the booking", () => {
    const r = validateBooking({ ...good, tz: "Not/AZone" });
    expect(r.ok).toBe(true);
    expect(r.clean.tz).toBe("");
  });
  it("treats a missing time zone as empty", () => {
    expect(validateBooking(good).clean.tz).toBe("");
  });
});

describe("validateReschedule", () => {
  it("requires a valid slot", () => {
    expect(validateReschedule({ slot: "2026-06-24T17:00:00Z" }).ok).toBe(true);
    expect(validateReschedule({ slot: "" }).ok).toBe(false);
  });
});

describe("validateInquiry", () => {
  const good = { name: "Ada", email: "ada@example.com", message: "Hello there" };
  it("accepts a complete payload", () => {
    expect(validateInquiry(good).ok).toBe(true);
  });
  it("requires a message", () => {
    expect(validateInquiry({ ...good, message: "" }).ok).toBe(false);
  });
  it("clamps the message to 2000 chars", () => {
    const r = validateInquiry({ ...good, message: "m".repeat(5000) });
    expect(r.clean.message.length).toBe(2000);
  });
});

describe("honeypotTripped", () => {
  it("is true when the honeypot is filled", () => {
    expect(honeypotTripped({ company: "Acme" })).toBe(true);
  });
  it("is false when empty / absent", () => {
    expect(honeypotTripped({ company: "" })).toBe(false);
    expect(honeypotTripped({})).toBe(false);
  });
});

describe("isIsoInstant", () => {
  it("accepts ISO instants and rejects junk", () => {
    expect(isIsoInstant("2026-06-24T17:00:00.000Z")).toBe(true);
    expect(isIsoInstant("not-a-date")).toBe(false);
    expect(isIsoInstant(12345)).toBe(false);
  });
});

describe("readiness gate", async () => {
  const { getConfig, readiness } = await import("../src/config.js");
  it("is not ready without Resend + a real meeting link", () => {
    const r = readiness(getConfig({}));
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual(["RESEND_API_KEY", "MEETING_URL"]);
  });
  it("is ready once both are set; Turnstile is only a warning", () => {
    const r = readiness(getConfig({ RESEND_API_KEY: "re_x", MEETING_URL: "https://meet.example.com/oja" }));
    expect(r.ready).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.warnings.join(" ")).toContain("TURNSTILE_SECRET");
  });
  it("can be bypassed for local dev only", () => {
    expect(readiness(getConfig({ ALLOW_UNCONFIGURED: "true" })).ready).toBe(true);
  });
});
