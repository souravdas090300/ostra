import { describe, it, expect, vi, beforeEach } from "vitest";
import { isDue, getMaxDuration } from "@/lib/scheduler";
import type { JobDef } from "@/lib/jobs";

describe("isDue", () => {
  it("returns true for interval job with no last start time", () => {
    const job: JobDef = { name: "test", every: 5, run: async () => ({ count: 1 }) };
    expect(isDue(job, null, new Date())).toBe(true);
  });

  it("returns true for interval job when enough time has passed", () => {
    const job: JobDef = { name: "test", every: 5, run: async () => ({ count: 1 }) };
    const now = new Date("2024-01-01T00:10:00Z");
    const lastStart = new Date("2024-01-01T00:04:00Z"); // 6 minutes ago
    expect(isDue(job, lastStart, now)).toBe(true);
  });

  it("returns false for interval job when not enough time has passed", () => {
    const job: JobDef = { name: "test", every: 5, run: async () => ({ count: 1 }) };
    const now = new Date("2024-01-01T00:08:00Z");
    const lastStart = new Date("2024-01-01T00:04:00Z"); // 4 minutes ago
    expect(isDue(job, lastStart, now)).toBe(false);
  });

  it("returns true for interval job with tolerance (30 seconds early)", () => {
    const job: JobDef = { name: "test", every: 5, run: async () => ({ count: 1 }) };
    const now = new Date("2024-01-01T00:08:30Z");
    const lastStart = new Date("2024-01-01T00:03:31Z"); // 4m 59s ago (within tolerance)
    expect(isDue(job, lastStart, now)).toBe(true);
  });

  it("returns true for interval job at exact interval", () => {
    const job: JobDef = { name: "test", every: 5, run: async () => ({ count: 1 }) };
    const now = new Date("2024-01-01T00:08:00Z");
    const lastStart = new Date("2024-01-01T00:03:00Z"); // 5m 0s ago (exact interval)
    expect(isDue(job, lastStart, now)).toBe(true);
  });

  it("catch-up runs once after long gap", () => {
    const job: JobDef = { name: "test", every: 5, run: async () => ({ count: 1 }) };
    const now = new Date("2024-01-01T02:00:00Z");
    const lastStart = new Date("2024-01-01T00:00:00Z"); // 2 hours ago (missed many slots)
    expect(isDue(job, lastStart, now)).toBe(true); // Still due once
  });

  it("returns true for fixed-time job at scheduled time", () => {
    const job: JobDef = {
      name: "test",
      at: { hourUtc: 6, minute: 0 },
      run: async () => ({ count: 1 }),
    };
    const now = new Date("2024-01-01T06:00:00Z");
    expect(isDue(job, null, now)).toBe(true);
  });

  it("returns true for fixed-time job after scheduled time", () => {
    const job: JobDef = {
      name: "test",
      at: { hourUtc: 6, minute: 0 },
      run: async () => ({ count: 1 }),
    };
    const now = new Date("2024-01-01T06:30:00Z");
    expect(isDue(job, null, now)).toBe(true);
  });

  it("returns false for fixed-time job before scheduled time", () => {
    const job: JobDef = {
      name: "test",
      at: { hourUtc: 6, minute: 0 },
      run: async () => ({ count: 1 }),
    };
    const now = new Date("2024-01-01T05:30:00Z");
    expect(isDue(job, null, now)).toBe(false);
  });

  it("returns false for fixed-time job after scheduled time if already ran", () => {
    const job: JobDef = {
      name: "test",
      at: { hourUtc: 6, minute: 0 },
      run: async () => ({ count: 1 }),
    };
    const now = new Date("2024-01-01T06:30:00Z");
    const lastStart = new Date("2024-01-01T06:00:00Z"); // Ran at scheduled time
    expect(isDue(job, lastStart, now)).toBe(false);
  });

  it("returns true for fixed-time job on correct weekday", () => {
    const job: JobDef = {
      name: "test",
      at: { hourUtc: 6, minute: 0, weekdayUtc: 1 }, // Monday
      run: async () => ({ count: 1 }),
    };
    const now = new Date("2024-01-01T06:00:00Z"); // Monday
    expect(isDue(job, null, now)).toBe(true);
  });

  it("returns false for fixed-time job on wrong weekday", () => {
    const job: JobDef = {
      name: "test",
      at: { hourUtc: 6, minute: 0, weekdayUtc: 1 }, // Monday
      run: async () => ({ count: 1 }),
    };
    const now = new Date("2024-01-02T06:00:00Z"); // Tuesday
    expect(isDue(job, null, now)).toBe(false);
  });

  it("handles midnight UTC boundary for fixed-time jobs", () => {
    const job: JobDef = {
      name: "test",
      at: { hourUtc: 0, minute: 0 },
      run: async () => ({ count: 1 }),
    };
    const now = new Date("2024-01-02T00:00:00Z"); // Midnight
    const lastStart = new Date("2024-01-01T23:59:00Z"); // Before midnight
    expect(isDue(job, lastStart, now)).toBe(true);
  });

  it("handles week boundary for weekly fixed-time jobs", () => {
    const job: JobDef = {
      name: "test",
      at: { hourUtc: 6, minute: 0, weekdayUtc: 1 }, // Monday
      run: async () => ({ count: 1 }),
    };
    const now = new Date("2024-01-08T06:00:00Z"); // Next Monday
    const lastStart = new Date("2024-01-01T06:00:00Z"); // Previous Monday
    expect(isDue(job, lastStart, now)).toBe(true);
  });
});

describe("getMaxDuration", () => {
  it("returns custom max duration when specified", () => {
    const job: JobDef = {
      name: "test",
      every: 5,
      run: async () => ({ count: 1 }),
      maxDuration: 20,
    };
    expect(getMaxDuration(job)).toBe(20);
  });

  it("returns default 10 minutes when not specified", () => {
    const job: JobDef = { name: "test", every: 5, run: async () => ({ count: 1 }) };
    expect(getMaxDuration(job)).toBe(10);
  });
});
