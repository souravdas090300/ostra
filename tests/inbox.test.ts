import { describe, it, expect, vi, beforeEach } from "vitest";
import { windowOpen, windowEnd, resolveGuestLanguage } from "@/lib/reply-window";
import { rateLimit, resetRateLimits } from "@/lib/rate-limit";
import { missingTokens } from "@/lib/translate-reply";

describe("window helpers", () => {
  it("never written is closed", () => {
    expect(windowEnd(null)).toBeNull();
    expect(windowOpen(null, new Date())).toBe(false);
  });

  it("one minute after the message is open", () => {
    const msgAt = new Date("2026-10-31T12:00:00Z");
    const now = new Date("2026-10-31T12:01:00Z");
    expect(windowEnd(msgAt)).not.toBeNull();
    expect(windowOpen(msgAt, now)).toBe(true);
  });

  it("open at 23h54m, closed at 23h56m", () => {
    const msgAt = new Date("2026-10-31T12:00:00Z");
    const openAt = new Date(msgAt.getTime() + 23 * 3_600_000 + 54 * 60_000);
    const closedAt = new Date(msgAt.getTime() + 23 * 3_600_000 + 56 * 60_000);
    expect(windowOpen(msgAt, openAt)).toBe(true);
    expect(windowOpen(msgAt, closedAt)).toBe(false);
  });

  it("closed at 24h and later", () => {
    const msgAt = new Date("2026-10-31T12:00:00Z");
    const at24h = new Date(msgAt.getTime() + 24 * 3_600_000);
    const at25h = new Date(msgAt.getTime() + 25 * 3_600_000);
    expect(windowOpen(msgAt, at24h)).toBe(false);
    expect(windowOpen(msgAt, at25h)).toBe(false);
  });

  it("resolveGuestLanguage: booking language wins", () => {
    expect(resolveGuestLanguage("en", "de", "fr")).toBe("en");
  });

  it("resolveGuestLanguage: then detected", () => {
    expect(resolveGuestLanguage(null, "de", "fr")).toBe("de");
  });

  it("resolveGuestLanguage: then owner default", () => {
    expect(resolveGuestLanguage(null, null, "fr")).toBe("fr");
  });
});

describe("rateLimit", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it("allows up to max", () => {
    const key = "test";
    expect(rateLimit(key, 3, 10_000, 0)).toBe(true);
    expect(rateLimit(key, 3, 10_000, 1000)).toBe(true);
    expect(rateLimit(key, 3, 10_000, 2000)).toBe(true);
  });

  it("blocks the next", () => {
    const key = "test";
    expect(rateLimit(key, 3, 10_000, 0)).toBe(true);
    expect(rateLimit(key, 3, 10_000, 1000)).toBe(true);
    expect(rateLimit(key, 3, 10_000, 2000)).toBe(true);
    expect(rateLimit(key, 3, 10_000, 3000)).toBe(false);
  });

  it("allows again after the window", () => {
    const key = "test";
    expect(rateLimit(key, 3, 10_000, 0)).toBe(true);
    expect(rateLimit(key, 3, 10_000, 1000)).toBe(true);
    expect(rateLimit(key, 3, 10_000, 2000)).toBe(true);
    expect(rateLimit(key, 3, 10_000, 3000)).toBe(false);
    expect(rateLimit(key, 3, 10_000, 11000)).toBe(true);
  });
});

describe("missingTokens", () => {
  it("all kept gives []", () => {
    expect(missingTokens("Meet at 15:00, code 1234", "Meet at 15:00, code 1234")).toEqual([]);
  });

  it("a changed price (120 to 130)", () => {
    expect(missingTokens("Price is 120", "Price is 130")).toEqual(["120"]);
  });

  it("a lost time (15:00)", () => {
    expect(missingTokens("Arrive at 15:00", "Arrive at three")).toEqual(["15:00"]);
  });

  it("a lost code (4821#)", () => {
    expect(missingTokens("Use code 4821#", "Use the code")).toEqual(["4821#"]);
  });

  it("a changed link", () => {
    expect(missingTokens("Go to https://example.com", "Go to https://other.com")).toEqual(["https://example.com"]);
  });

  it("a password with punctuation (Seaview!2026)", () => {
    expect(missingTokens("Password: Seaview!2026", "Password: changed")).toEqual(["Seaview!2026"]);
  });

  it("tokens with trailing punctuation are matched correctly", () => {
    expect(missingTokens("Arrive at 15:00.", "Arrive at three.")).toEqual(["15:00"]);
    expect(missingTokens("Code: 1234!", "Code: changed!")).toEqual(["1234"]);
  });

  it("text without digits or links gives []", () => {
    expect(missingTokens("Hello there", "Hola")).toEqual([]);
  });

  it("Arabic-Indic digits in the translation are reported as missing", () => {
    expect(missingTokens("Code 1234", "Code ١٢٣٤")).toEqual(["1234"]);
  });
});
