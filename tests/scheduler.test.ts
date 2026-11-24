import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isDue,
  claimJobLease,
  releaseJobLease,
  runTick,
  type TickOptions,
} from "@/lib/scheduler";
import type { JobDef } from "@/lib/jobs";
import { prisma } from "@/lib/db";
import { cleanupDatabase } from "./test-helpers";

const intervalJob = (name: string, every: number): JobDef => ({
  name,
  every,
  run: async () => ({}),
});

const dailyJob = (name: string, hourUtc: number, minute: number): JobDef => ({
  name,
  at: { hourUtc, minute },
  run: async () => ({}),
});

const weeklyJob = (
  name: string,
  hourUtc: number,
  minute: number,
  weekdayUtc: number
): JobDef => ({
  name,
  at: { hourUtc, minute, weekdayUtc },
  run: async () => ({}),
});

describe("isDue", () => {
  it("interval job with no previous start is due", () => {
    const now = new Date("2026-11-23T12:00:00Z");
    expect(isDue(intervalJob("j", 5), null, now)).toBe(true);
  });

  it("interval job inside the tolerance window is due", () => {
    const job = intervalJob("j", 5); // due at >= 270s elapsed
    const last = new Date("2026-11-23T11:55:30Z");
    // 270s exactly -> due
    expect(isDue(job, last, new Date("2026-11-23T12:00:00Z"))).toBe(true);
    // 269s -> not due
    expect(isDue(job, last, new Date("2026-11-23T11:59:59Z"))).toBe(false);
  });

  it("interval job just after the interval is due", () => {
    const job = intervalJob("j", 5);
    const last = new Date("2026-11-23T11:50:00Z");
    expect(isDue(job, last, new Date("2026-11-23T11:56:00Z"))).toBe(true);
  });

  it("fixed daily job runs once per slot and catches up once", () => {
    const job = dailyJob("retention", 1, 30);
    const today = new Date("2026-11-23T02:00:00Z"); // after 01:30
    // Never ran -> due
    expect(isDue(job, null, today)).toBe(true);
    // Ran after today's slot -> not due again today
    const ranToday = new Date("2026-11-23T01:35:00Z");
    expect(isDue(job, ranToday, today)).toBe(false);
    // Ran yesterday -> today's slot is missed -> due once (catch-up)
    const ranYesterday = new Date("2026-11-22T01:35:00Z");
    expect(isDue(job, ranYesterday, today)).toBe(true);
    // Before today's slot but after yesterday's run -> not due
    const beforeSlot = new Date("2026-11-23T01:00:00Z");
    expect(isDue(job, ranYesterday, beforeSlot)).toBe(false);
  });

  it("fixed daily job across UTC midnight", () => {
    const job = dailyJob("midnight", 0, 30);
    const justAfter = new Date("2026-11-23T00:45:00Z");
    const ranYesterday = new Date("2026-11-22T00:35:00Z");
    expect(isDue(job, ranYesterday, justAfter)).toBe(true);
    const ranToday = new Date("2026-11-23T00:35:00Z");
    expect(isDue(job, ranToday, justAfter)).toBe(false);
  });

  it("fixed weekly job runs on the configured weekday only", () => {
    const job = weeklyJob("weekly", 6, 0, 1); // Monday 06:00 UTC
    const monday = new Date("2026-11-23T07:00:00Z"); // a Monday
    const tuesday = new Date("2026-11-24T07:00:00Z");
    // Never ran, Monday after slot -> due
    expect(isDue(job, null, monday)).toBe(true);
    // Ran this Monday -> not due
    const ranMonday = new Date("2026-11-23T06:05:00Z");
    expect(isDue(job, ranMonday, monday)).toBe(false);
    expect(isDue(job, ranMonday, tuesday)).toBe(false);
    // Missed this Monday during an outage -> catches up once mid-week
    const ranLastWeek = new Date("2026-11-16T06:05:00Z");
    expect(isDue(job, ranLastWeek, tuesday)).toBe(true);
    // ...but only once: after the catch-up run it is not due again
    const caughtUp = new Date("2026-11-24T07:30:00Z");
    expect(isDue(job, caughtUp, new Date("2026-11-24T08:00:00Z"))).toBe(false);
  });

  it("fixed weekly job across a week boundary", () => {
    const job = weeklyJob("weekly", 6, 0, 1);
    // Sunday: most recent Monday slot was 6 days ago
    const sunday = new Date("2026-11-22T12:00:00Z");
    const ranLastMonday = new Date("2026-11-16T06:05:00Z");
    expect(isDue(job, ranLastMonday, sunday)).toBe(false);
    const missedLastMonday = new Date("2026-11-09T06:05:00Z");
    expect(isDue(job, missedLastMonday, sunday)).toBe(true);
  });

  it("is deterministic for a given clock — unaffected by wall-clock changes", () => {
    const job = intervalJob("j", 30);
    const last = new Date("2026-11-23T00:00:00Z");
    const now = new Date("2026-11-23T00:31:00Z");
    const first = isDue(job, last, now);
    const second = isDue(job, last, now);
    expect(first).toBe(second);
    expect(first).toBe(true);
  });
});

describe("job leases", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  it("two concurrent claims: only one wins", async () => {
    const now = new Date();
    const until = new Date(now.getTime() + 10 * 60_000);
    const [a, b] = await Promise.all([
      claimJobLease("race", until, now),
      claimJobLease("race", until, now),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("an expired lease can be taken over", async () => {
    const past = new Date(Date.now() - 60_000);
    await prisma.jobLease.create({
      data: { job: "expired", leasedUntil: past },
    });
    const now = new Date();
    const claimed = await claimJobLease(
      "expired",
      new Date(now.getTime() + 10 * 60_000),
      now
    );
    expect(claimed).toBe(true);
  });

  it("a held lease is not claimable", async () => {
    const now = new Date();
    await claimJobLease("held", new Date(now.getTime() + 10 * 60_000), now);
    const again = await claimJobLease(
      "held",
      new Date(now.getTime() + 10 * 60_000),
      now
    );
    expect(again).toBe(false);
  });

  it("release makes the lease claimable again", async () => {
    const now = new Date();
    await claimJobLease("released", new Date(now.getTime() + 10 * 60_000), now);
    await releaseJobLease("released", now);
    const later = new Date(now.getTime() + 60_000);
    const claimed = await claimJobLease(
      "released",
      new Date(later.getTime() + 10 * 60_000),
      later
    );
    expect(claimed).toBe(true);
  });
});

describe("runTick", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  const stubJob = (name: string, every: number, impl?: () => Promise<Record<string, number>>): JobDef => ({
    name,
    every,
    run: impl ?? (async () => ({ ran: 1 })),
  });

  it("runs only due jobs, in the order given", async () => {
    const now = new Date("2026-11-23T12:00:00Z");
    const order: string[] = [];
    const mk = (name: string) =>
      stubJob(name, 5, async () => {
        order.push(name);
        return {};
      });
    const result = await runTick(now, {
      jobs: [mk("first"), mk("second")],
    });
    expect(result.ran).toEqual(["first", "second"]);
    expect(order).toEqual(["first", "second"]);
    expect(result.failed).toBe(0);
  });

  it("skips jobs that are not due", async () => {
    const now = new Date("2026-11-23T12:00:00Z");
    await prisma.jobRun.create({
      data: { job: "recent", startedAt: new Date(now.getTime() - 60_000), ok: true },
    });
    const run = vi.fn(async () => ({}));
    const result = await runTick(now, {
      jobs: [stubJob("recent", 30, run), stubJob("fresh", 30, run)],
    });
    expect(result.ran).toEqual(["fresh"]);
    expect(result.skipped).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a failing job does not stop later jobs and is recorded", async () => {
    const now = new Date("2026-11-23T12:00:00Z");
    const result = await runTick(now, {
      jobs: [
        stubJob("bad", 5, async () => {
          throw new Error("boom");
        }),
        stubJob("good", 5),
      ],
    });
    expect(result.ran).toEqual(["good"]);
    expect(result.failed).toBe(1);
    const badRun = await prisma.jobRun.findFirst({
      where: { job: "bad" },
      orderBy: { startedAt: "desc" },
    });
    expect(badRun?.ok).toBe(false);
    const goodRun = await prisma.jobRun.findFirst({
      where: { job: "good" },
      orderBy: { startedAt: "desc" },
    });
    expect(goodRun?.ok).toBe(true);
  });

  it("a throwing job still releases its lease", async () => {
    const now = new Date("2026-11-23T12:00:00Z");
    await runTick(now, {
      jobs: [
        stubJob("throws", 5, async () => {
          throw new Error("boom");
        }),
      ],
    });
    const later = new Date(now.getTime() + 60_000);
    const claimed = await claimJobLease(
      "throws",
      new Date(later.getTime() + 10 * 60_000),
      later
    );
    expect(claimed).toBe(true);
  });

  it("a held lease causes the job to be skipped", async () => {
    const now = new Date("2026-11-23T12:00:00Z");
    await claimJobLease("leased", new Date(now.getTime() + 10 * 60_000), now);
    const run = vi.fn(async () => ({}));
    const result = await runTick(now, { jobs: [stubJob("leased", 5, run)] });
    expect(result.ran).toEqual([]);
    expect(result.skipped).toBe(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("two concurrent ticks start each job at most once", async () => {
    const now = new Date("2026-11-23T12:00:00Z");
    const run = vi.fn(async () => ({}));
    const jobs = [stubJob("once", 5, run)];
    const [a, b] = await Promise.all([
      runTick(now, { jobs }),
      runTick(now, { jobs }),
    ]);
    expect(a.ran.length + b.ran.length).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);
    const runs = await prisma.jobRun.count({ where: { job: "once" } });
    expect(runs).toBe(1);
  });

  it("stops starting new jobs once the time budget is exhausted", async () => {
    const now = new Date("2026-11-23T12:00:00Z");
    const run = vi.fn(async () => ({}));
    const opts: TickOptions = {
      budgetMs: 0,
      jobs: [stubJob("never", 5, run)],
    };
    const result = await runTick(now, opts);
    expect(result.ran).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it("a second tick one minute later does not rerun jobs that are not due", async () => {
    const t0 = new Date("2026-11-23T12:00:00Z");
    const run = vi.fn(async () => ({}));
    const jobs = [stubJob("hourly-ish", 60, run)];
    await runTick(t0, { jobs });
    const t1 = new Date(t0.getTime() + 60_000);
    const second = await runTick(t1, { jobs });
    expect(second.ran).toEqual([]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("respects the AUTOMATIC_MESSAGES_ENABLED kill switch inside the job", async () => {
    const now = new Date("2026-11-23T12:00:00Z");
    process.env.AUTOMATIC_MESSAGES_ENABLED = "false";
    try {
      const { sendDueMessagesJob } = await import("@/lib/jobs");
      const result = await runTick(now, {
        jobs: [{ name: "send-scheduled", every: 5, run: sendDueMessagesJob }],
      });
      expect(result.ran).toEqual(["send-scheduled"]);
      const runRow = await prisma.jobRun.findFirst({
        where: { job: "send-scheduled" },
        orderBy: { startedAt: "desc" },
      });
      expect(runRow?.summary).toContain('"sent":0');
    } finally {
      delete process.env.AUTOMATIC_MESSAGES_ENABLED;
    }
  });
});
