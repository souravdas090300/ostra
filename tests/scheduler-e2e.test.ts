import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runTick } from "@/lib/scheduler";
import { JOBS, type JobDef } from "@/lib/jobs";
import { prisma } from "@/lib/db";
import { cleanupDatabase } from "./test-helpers";

/**
 * End-to-end fake-clock test: simulates 24 hours of ticks, one per minute,
 * against stub job bodies that mirror the real registry schedule. Asserts
 * each job runs the expected number of times (catch-up runs once, never in
 * a burst).
 */
describe("scheduler fake-clock e2e (24h)", () => {
  beforeAll(async () => {
    await cleanupDatabase();
  });

  afterAll(async () => {
    await cleanupDatabase();
  });

  it(
    "runs each job the expected number of times over 24 hours",
    async () => {
      const counts = new Map<string, number>();
      const stubJobs: JobDef[] = JOBS.map((j) => ({
        ...j,
        run: async () => {
          counts.set(j.name, (counts.get(j.name) ?? 0) + 1);
          return {};
        },
      }));

      // Window: Monday 2026-11-23 02:00 UTC -> Tuesday 2026-11-24 01:59 UTC.
      // Pre-seed the two fixed-time jobs as having run just before the window
      // so each fires exactly once inside it (Monday 06:00 summary, Tuesday
      // 01:30 retention).
      const start = new Date("2026-11-23T02:00:00Z");
      const seeded = new Date(start.getTime() - 60_000);
      for (const name of ["retention", "weekly-summary"]) {
        await prisma.jobRun.create({
          data: { job: name, startedAt: seeded, ok: true },
        });
      }

      for (let minute = 0; minute < 24 * 60; minute++) {
        const now = new Date(start.getTime() + minute * 60_000);
        await runTick(now, { jobs: stubJobs });
      }

      const got = (name: string) => counts.get(name) ?? 0;

      // Interval jobs: 5-minute jobs run every ~5 ticks -> ~288 times.
      expect(got("send-scheduled")).toBe(288);
      expect(got("inbound-recovery")).toBe(288);
      // 30-minute job -> 48; 15-minute jobs -> 96; 60-minute job -> 24.
      expect(got("sync-calendars")).toBe(48);
      expect(got("escalation-reminders")).toBe(96);
      expect(got("self-check")).toBe(96);
      expect(got("lead-follow-ups")).toBe(96);
      expect(got("sync-templates")).toBe(24);
      // Fixed-time jobs: exactly once each inside the window.
      expect(got("retention")).toBe(1);
      expect(got("weekly-summary")).toBe(1);
    },
    300_000
  );
});
