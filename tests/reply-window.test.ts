import { describe, it, expect } from "vitest";
import { windowOpen, windowEnd, resolveGuestLanguage } from "@/lib/reply-window";

describe("windowOpen / windowEnd", () => {
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
    const openAt = new Date(msgAt.getTime() + 23 * 3_600_000 + 54 * 60_000); // 23h54m
    const closedAt = new Date(msgAt.getTime() + 23 * 3_600_000 + 56 * 60_000); // 23h56m
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
});

describe("resolveGuestLanguage", () => {
  it("booking language wins", () => {
    expect(resolveGuestLanguage("en", "de", "fr")).toBe("en");
  });

  it("then detected", () => {
    expect(resolveGuestLanguage(null, "de", "fr")).toBe("de");
  });

  it("then owner default", () => {
    expect(resolveGuestLanguage(null, null, "fr")).toBe("fr");
  });
});
