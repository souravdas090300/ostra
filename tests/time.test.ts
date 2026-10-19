import { describe, it, expect } from "vitest";
import { maltaLocalToUtc, maltaYmd } from "@/lib/time";

describe("time utilities", () => {
  it("maltaLocalToUtc converts winter time (UTC+1) correctly", () => {
    // Winter: Malta is UTC+1, so 15:00 Malta = 14:00 UTC
    const result = maltaLocalToUtc("2026-11-05", "15:00");
    expect(result.toISOString()).toBe("2026-11-05T14:00:00.000Z");
  });

  it("maltaLocalToUtc converts summer time (UTC+2) correctly", () => {
    // Summer: Malta is UTC+2, so 15:00 Malta = 13:00 UTC
    const result = maltaLocalToUtc("2027-07-10", "15:00");
    expect(result.toISOString()).toBe("2027-07-10T13:00:00.000Z");
  });

  it("maltaYmd formats a UTC date as Malta YYYY-MM-DD", () => {
    const date = new Date("2026-11-05T14:00:00.000Z");
    expect(maltaYmd(date)).toBe("2026-11-05");
  });
});
