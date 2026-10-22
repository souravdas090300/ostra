import { describe, it, expect, beforeEach } from "vitest";
import { rateLimit, resetRateLimits } from "@/lib/rate-limit";

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
