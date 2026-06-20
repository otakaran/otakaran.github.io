import { describe, it, expect } from "vitest";
import { newToken, hashToken, newId } from "../src/tokens.js";

describe("newToken", () => {
  it("is URL-safe and high-entropy", () => {
    const t = newToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBeGreaterThanOrEqual(40);
  });
  it("differs between calls", () => {
    expect(newToken()).not.toBe(newToken());
  });
});

describe("hashToken", () => {
  it("is deterministic for the same token + salt", async () => {
    const a = await hashToken("abc", "salt");
    const b = await hashToken("abc", "salt");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it("changes with the salt", async () => {
    expect(await hashToken("abc", "s1")).not.toBe(await hashToken("abc", "s2"));
  });
  it("changes with the token", async () => {
    expect(await hashToken("abc", "s")).not.toBe(await hashToken("abd", "s"));
  });
});

describe("newId", () => {
  it("returns a non-empty unique id", () => {
    expect(newId()).not.toBe(newId());
    expect(newId().length).toBeGreaterThan(0);
  });
});
