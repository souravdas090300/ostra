import { NextResponse } from "next/server";
import { JOBS } from "@/lib/jobs";
import { withJobRun } from "@/lib/job-run";
import { isDue, claimLease, releaseLease, getLastStartTimes, sendHeartbeat, getMaxDuration } from "@/lib/scheduler";
import { requireCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TIME_BUDGET_MS = 50_000; // 50 seconds default time budget

export async function POST(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  return await tickHandler();
}

export async function GET(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  return await tickHandler();
}

async function tickHandler(): Promise<NextResponse> {
  const now = new Date();
  const startTime = now.getTime();
  const lastStarts = await getLastStartTimes();

  const ran: string[] = [];
  let skipped = 0;
  let failed = 0;

  for (const job of JOBS) {
    // Check time budget
    const elapsed = new Date().getTime() - startTime;
    if (elapsed >= TIME_BUDGET_MS) {
      skipped++;
      continue;
    }

    // Check if job is due
    if (!isDue(job, lastStarts[job.name], now)) {
      continue;
    }

    // Claim lease
    const maxDuration = getMaxDuration(job);
    const claimed = await claimLease(job.name, maxDuration);
    if (!claimed) {
      skipped++;
      continue;
    }

    // Run the job
    try {
      const result = await withJobRun(job.name, job.run);
      ran.push(job.name);

      // Send heartbeat if configured
      await sendHeartbeat(job.name);
    } catch (e) {
      failed++;
      // Error is already recorded by withJobRun
    } finally {
      // Always release the lease
      await releaseLease(job.name);
    }
  }

  // Send tick heartbeat if configured
  const tickPingUrl = process.env.PING_URL_TICK;
  if (tickPingUrl) {
    try {
      await fetch(tickPingUrl, { method: "GET", signal: AbortSignal.timeout(5_000) });
    } catch {
      // Heartbeat failure is logged but doesn't fail the response
    }
  }

  return NextResponse.json({
    ran,
    skipped,
    failed,
    timestamp: now.toISOString(),
  });
}
