import { prisma } from "./db";
import type { JobDef } from "./jobs";

const TOLERANCE_MS = 30_000; // 30 seconds tolerance for early ticks

/**
 * Determine if a job is due to run based on its schedule and last run time.
 */
export function isDue(job: JobDef, lastStartedAt: Date | null, now: Date = new Date()): boolean {
  if ("every" in job) {
    // Interval job: due when lastStartedAt is missing or enough time has passed
    if (!lastStartedAt) return true;
    const elapsed = now.getTime() - lastStartedAt.getTime();
    const intervalMs = job.every * 60_000;
    return elapsed >= intervalMs - TOLERANCE_MS;
  } else {
    // Fixed-time job: due when now is at or after today's scheduled time
    const { hourUtc, minute, weekdayUtc } = job.at;

    // Create today's scheduled time in UTC
    const scheduled = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, minute));

    // Check weekday constraint
    if (weekdayUtc !== undefined && now.getUTCDay() !== weekdayUtc) {
      return false;
    }

    // If we're past today's scheduled time, and haven't run since then, we're due
    if (now >= scheduled) {
      if (!lastStartedAt) return true;
      // Only due if last run was before today's scheduled time
      return lastStartedAt < scheduled;
    }

    return false;
  }
}

/**
 * Get the maximum duration for a job in minutes.
 */
export function getMaxDuration(job: JobDef): number {
  if (job.maxDuration) return job.maxDuration;
  return 10; // Default 10 minutes
}

/**
 * Claim a lease for a job atomically.
 * Returns true if the lease was claimed, false if another runner holds it.
 */
export async function claimLease(job: string, durationMinutes: number): Promise<boolean> {
  const result = await prisma.$queryRaw<{ job: string }[]>`
    INSERT INTO "JobLease" ("job", "leasedUntil")
    VALUES (${job}, now() + ${durationMinutes} * INTERVAL '1 minute')
    ON CONFLICT ("job") DO UPDATE SET "leasedUntil" = EXCLUDED."leasedUntil"
    WHERE "JobLease"."leasedUntil" < now()
    RETURNING "job"
  `;
  return result.length > 0;
}

/**
 * Release a lease for a job.
 */
export async function releaseLease(job: string): Promise<void> {
  await prisma.jobLease.update({
    where: { job },
    data: { leasedUntil: new Date() },
  });
}

/**
 * Get the last start time for each job in a single query.
 */
export async function getLastStartTimes(): Promise<Record<string, Date | null>> {
  const results = await prisma.$queryRaw<
    Array<{ job: string; startedAt: Date }>
  >`
    SELECT DISTINCT ON ("job") "job", "startedAt"
    FROM "JobRun"
    ORDER BY "job", "startedAt" DESC
  `;

  const lastStarts: Record<string, Date | null> = {};
  for (const { job, startedAt } of results) {
    lastStarts[job] = startedAt;
  }

  // Ensure all jobs have an entry (even if null)
  const { JOBS } = await import("./jobs");
  for (const job of JOBS) {
    if (!(job.name in lastStarts)) {
      lastStarts[job.name] = null;
    }
  }

  return lastStarts;
}

/**
 * Send a heartbeat ping if a URL is configured.
 */
export async function sendHeartbeat(job: string): Promise<void> {
  const url = process.env[`PING_URL_${job.toUpperCase().replace(/-/g, "_")}`];
  if (!url) return;

  try {
    await fetch(url, { method: "GET", signal: AbortSignal.timeout(5_000) });
  } catch {
    // Heartbeat failures are logged but don't fail the job
  }
}
