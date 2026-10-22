import { prisma } from "@/lib/db";
import { reportError } from "@/lib/report-error";
import { withJobRun } from "@/lib/job-run";
import { notifyHost } from "@/lib/notify";
import { revalidatePath } from "next/cache";

const OPERATOR_EMAIL = process.env.OPERATOR_EMAIL;

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await withJobRun("self-check", async () => {
    const now = new Date();
    const alerts: string[] = [];

    // Check last successful run times
    const staleJobs = await checkStaleJobs(now);
    if (staleJobs.length > 0) {
      alerts.push(`Stale jobs: ${staleJobs.join(", ")}`);
    }

    // Check overdue scheduled messages
    const overduePending = await prisma.scheduledMessage.count({
      where: {
        status: "PENDING",
        sendAt: { lt: new Date(now.getTime() - 30 * 60_000) },
      },
    });
    if (overduePending > 0) {
      alerts.push(`${overduePending} overdue pending scheduled messages`);
    }

    // Check failed messages in last 24 hours
    const failedScheduled = await prisma.scheduledMessage.count({
      where: {
        status: "FAILED",
        lastError: { not: null },
        createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) },
      },
    });
    const failedOutbound = await prisma.message.count({
      where: {
        direction: "OUTBOUND",
        deliveryStatus: { in: ["failed", "undelivered"] },
        createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) },
      },
    });
    if (failedScheduled > 0 || failedOutbound > 0) {
      alerts.push(`${failedScheduled} failed scheduled, ${failedOutbound} failed outbound messages`);
    }

    // Check unresolved urgent escalations
    const urgentEscalations = await prisma.message.count({
      where: {
        escalated: true,
        resolved: false,
        urgent: true,
        createdAt: { lt: new Date(now.getTime() - 15 * 60_000) },
      },
    });
    if (urgentEscalations > 0) {
      alerts.push(`${urgentEscalations} unresolved urgent escalations older than 15 min`);
    }

    // Check feeds with errors
    const feedsWithErrors = await prisma.calendarFeed.count({
      where: {
        lastError: { not: null },
        OR: [
          { lastSuccessAt: { lt: new Date(now.getTime() - 3 * 60 * 60_000) } },
          { lastSuccessAt: null },
        ],
      },
    });
    if (feedsWithErrors > 0) {
      alerts.push(`${feedsWithErrors} feeds with errors or no success for 3 hours`);
    }

    // Check if this is a new alert state (transition from OK to degraded)
    const lastRun = await prisma.jobRun.findFirst({
      where: { job: "self-check", ok: true },
      orderBy: { startedAt: "desc" },
    });
    const wasOk = lastRun && !lastRun.summary?.includes("alerts");
    const isDegraded = alerts.length > 0;

    if (isDegraded && (wasOk || !lastRun)) {
      // Send operator email on transition to degraded
      if (OPERATOR_EMAIL) {
        await notifyHost({
          to: OPERATOR_EMAIL,
          subject: "Ostra self-check: degraded",
          text: `Self-check found problems:\n\n${alerts.join("\n")}\n\nCheck /settings/status`,
        });
      }
    }

    revalidatePath("/settings/status");

    return {
      staleJobs: staleJobs.length,
      overduePending,
      failedScheduled,
      failedOutbound,
      urgentEscalations,
      feedsWithErrors,
      alerts: alerts.length,
    };
  });

  return Response.json(result);
}

async function checkStaleJobs(now: Date): Promise<string[]> {
  const stale: string[] = [];
  const thresholds: Record<string, number> = {
    "sync-calendars": 90 * 60_000,
    "send-scheduled": 30 * 60_000,
    "escalation-reminders": 45 * 60_000,
    "sync-templates": 3 * 60 * 60_000,
    "retention": 36 * 60 * 60_000,
    "inbound-recovery": 20 * 60_000,
  };

  for (const [job, threshold] of Object.entries(thresholds)) {
    const lastOk = await prisma.jobRun.findFirst({
      where: { job, ok: true },
      orderBy: { startedAt: "desc" },
    });
    if (!lastOk || new Date(now.getTime() - threshold) > lastOk.startedAt) {
      stale.push(job);
    }
  }

  return stale;
}
