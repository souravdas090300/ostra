import { prisma } from './db';
import { withJobRun } from './job-run';
import { reportError } from './report-error';
import { JOBS, type JobDef } from './jobs';

const MINUTE = 60_000;
const TOLERANCE_MS = 30_000;
const DEFAULT_BUDGET_MS = 50_000;
const DEFAULT_LEASE_MINUTES = 10;

/**
 * Most recent scheduled instant at or before `now`, in UTC. For weekly jobs
 * this looks back up to 7 days so a slot missed during an outage still
 * catches up exactly once; for daily jobs up to 2 days.
 */
function latestScheduledAt(
  at: { hourUtc: number; minute: number; weekdayUtc?: number },
  now: Date
): Date | null {
  const maxLookback = at.weekdayUtc !== undefined ? 8 : 2;
  for (let i = 0; i <= maxLookback; i++) {
    const day = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - i
      )
    );
    if (at.weekdayUtc !== undefined && day.getUTCDay() !== at.weekdayUtc)
      continue;
    const candidate = new Date(
      Date.UTC(
        day.getUTCFullYear(),
        day.getUTCMonth(),
        day.getUTCDate(),
        at.hourUtc,
        at.minute
      )
    );
    if (candidate.getTime() <= now.getTime()) return candidate;
  }
  return null;
}

/**
 * Whether a job should start at `now`, given the most recent JobRun start.
 * Interval jobs tolerate a tick arriving a few seconds early; fixed-time jobs
 * run once per scheduled slot and catch up at most once after an outage.
 */
export function isDue(
  job: JobDef,
  lastStartedAt: Date | null,
  now: Date
): boolean {
  if ('every' in job) {
    if (!lastStartedAt) return true;
    return (
      now.getTime() - lastStartedAt.getTime() >=
      job.every * MINUTE - TOLERANCE_MS
    );
  }
  const sched = latestScheduledAt(job.at, now);
  if (!sched) return false;
  return !lastStartedAt || lastStartedAt.getTime() < sched.getTime();
}

/**
 * Atomically claim the lease for a job. Returns false when another runner
 * holds an unexpired lease. `now` is compared in SQL so fake clocks and
 * database time stay consistent.
 */
export async function claimJobLease(
  job: string,
  leasedUntil: Date,
  now: Date
): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ job: string }[]>`
    INSERT INTO "JobLease" ("job", "leasedUntil") VALUES (${job}, ${leasedUntil})
    ON CONFLICT ("job") DO UPDATE SET "leasedUntil" = EXCLUDED."leasedUntil"
    WHERE "JobLease"."leasedUntil" < ${now}
    RETURNING "job"`;
  return rows.length > 0;
}

export async function releaseJobLease(job: string, now: Date): Promise<void> {
  await prisma.jobLease.updateMany({
    where: { job },
    data: { leasedUntil: now },
  });
}

export type TickResult = { ran: string[]; skipped: number; failed: number };
export type TickOptions = { budgetMs?: number; jobs?: JobDef[] };

/**
 * One scheduler pass: run every due job once, in registry order, each under
 * its own lease and JobRun record. A failing job never stops the others and
 * retries at its normal interval because JobRun is written regardless of ok.
 */
export async function runTick(
  now = new Date(),
  opts: TickOptions = {}
): Promise<TickResult> {
  const jobs = opts.jobs ?? JOBS;
  const budgetMs =
    opts.budgetMs ??
    Number(process.env.TICK_TIME_BUDGET_MS ?? DEFAULT_BUDGET_MS);
  const started = Date.now();

  const lastRuns = await prisma.jobRun.groupBy({
    by: ['job'],
    _max: { startedAt: true },
  });
  const lastStart = new Map(lastRuns.map((r) => [r.job, r._max.startedAt]));

  const result: TickResult = { ran: [], skipped: 0, failed: 0 };

  for (const job of jobs) {
    if (Date.now() - started >= budgetMs) break;
    const last = lastStart.get(job.name) ?? null;
    if (!isDue(job, last, now)) {
      result.skipped++;
      continue;
    }
    const leaseMinutes = job.maxDuration ?? DEFAULT_LEASE_MINUTES;
    const claimed = await claimJobLease(
      job.name,
      new Date(now.getTime() + leaseMinutes * MINUTE),
      now
    );
    if (!claimed) {
      result.skipped++;
      continue;
    }
    try {
      await withJobRun(job.name, () => job.run(), now);
      result.ran.push(job.name);
      lastStart.set(job.name, now);
    } catch (e) {
      reportError(e, { job: job.name });
      result.failed++;
      lastStart.set(job.name, now);
    } finally {
      await releaseJobLease(job.name, now);
    }
  }

  // External heartbeat: a stopped scheduler is noticed even when nothing was due.
  const pingUrl = process.env.PING_URL_TICK;
  if (pingUrl) {
    try {
      await fetch(pingUrl, {
        method: 'POST',
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      /* heartbeat is best-effort */
    }
  }

  return result;
}
