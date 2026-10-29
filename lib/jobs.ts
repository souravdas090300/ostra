// Job implementations intentionally use await inside loops for:
// - Sequential processing to avoid database overload
// - Conditional logic that depends on query results
// - Rate limiting of external API calls (email notifications)
// These patterns are copied from the original job implementations.

import { sendDueMessages } from "./send-scheduled";
import { syncAllFeeds } from "./sync";
import { syncApprovals } from "./template-approval";
import { runRetention } from "./retention";
import { buildWeeklySummary, getIsoWeekString } from "./weekly-summary";
import { processLeadFollowUps } from "./lead-follow-up";

export type JobDef =
  | { name: string; every: number; run: () => Promise<Record<string, number>>; maxDuration?: number }
  | {
      name: string;
      at: { hourUtc: number; minute: number; weekdayUtc?: number };
      run: () => Promise<Record<string, number>>;
      maxDuration?: number;
    };

// Interval-based jobs (every N minutes)
export const sendDueMessagesJob = async (): Promise<Record<string, number>> => {
  const result = await sendDueMessages();
  return {
    claimed: result.claimed,
    sent: result.sent,
    skipped: result.skipped,
    failed: result.failed,
    retried: result.retried,
  };
};

export const inboundRecoveryJob = async (): Promise<Record<string, number>> => {
  // Reuse the existing inbound-recovery logic
  const { withJobRun } = await import("./job-run");
  const result = await withJobRun("inbound-recovery", async () => {
    const { prisma } = await import("./db");
    const { notifyHost } = await import("./notify");
    const { revalidatePath } = await import("next/cache");

    const now = new Date();
    const threeMinutesAgo = new Date(now.getTime() - 3 * 60_000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60_000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60_000);

    const unansweredMessages = await prisma.message.findMany({
      where: {
        direction: "INBOUND",
        author: "GUEST",
        escalated: false,
        createdAt: { gte: threeMinutesAgo, lte: twentyFourHoursAgo },
      },
      include: {
        booking: {
          include: {
            apartment: {
              include: {
                owner: true,
              },
            },
          },
        },
      },
    });

    let escalated = 0;

    // Sequential processing: await inside loop is intentional to avoid
    // database overload and allow conditional logic per message
    for (const message of unansweredMessages) {
      const hasReply = await prisma.message.count({
        where: {
          bookingId: message.bookingId,
          direction: "OUTBOUND",
          createdAt: { gt: message.createdAt },
        },
      });

      if (hasReply > 0) continue;

      const floodCount = await prisma.message.count({
        where: {
          bookingId: message.bookingId,
          direction: "INBOUND",
          createdAt: { gte: oneHourAgo },
        },
      });

      if (floodCount >= 20) continue;

      await prisma.message.update({
        where: { id: message.id },
        data: {
          escalated: true,
          escalationReason: "No reply was sent (the system restarted). Please answer.",
          hostSummary: "A guest message was not answered automatically. Please reply.",
        },
      });

      await notifyHost({
        to: message.booking.apartment.owner.email,
        subject: `Guest needs you at ${message.booking.apartment.name}`,
        text: `${message.hostSummary}\n\nOpen: ${process.env.APP_URL}/inbox/${message.bookingId}`,
      });

      escalated++;
    }

    revalidatePath("/inbox");

    return { escalated };
  });
  return result;
};

export const syncAllFeedsJob = async (): Promise<Record<string, number>> => {
  const results = await syncAllFeeds();
  return {
    feeds: results.length,
    failed: results.filter((r) => !r.ok).length,
    created: results.reduce((n, r) => n + r.created, 0),
    updated: results.reduce((n, r) => n + r.updated, 0),
    cancelled: results.reduce((n, r) => n + r.cancelled, 0),
  };
};

export const escalationRemindersJob = async (): Promise<Record<string, number>> => {
  const { withJobRun } = await import("./job-run");
  const result = await withJobRun("escalation-reminders", async () => {
    const { prisma } = await import("./db");
    const { notifyHost } = await import("./notify");
    const { revalidatePath } = await import("next/cache");

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60_000);

    const needsReminder = await prisma.message.findMany({
      where: {
        escalated: true,
        resolved: false,
        reminderSentAt: null,
        createdAt: { lt: oneHourAgo },
      },
      include: {
        booking: {
          include: {
            apartment: {
              include: {
                owner: true,
              },
            },
          },
        },
      },
    });

    const needsLeadReminder = await prisma.leadMessage.findMany({
      where: {
        escalated: true,
        resolved: false,
        reminderSentAt: null,
        createdAt: { lt: oneHourAgo },
      },
      include: {
        lead: {
          include: {
            owner: true,
          },
        },
      },
    });

    let reminded = 0;

    // Sequential processing: await inside loop is intentional for rate limiting
    // email notifications and conditional updates per message
    for (const message of needsReminder) {
      await notifyHost({
        to: message.booking.apartment.owner.email,
        subject: `Reminder: Guest needs you at ${message.booking.apartment.name}`,
        text: `${message.hostSummary}\n\nOpen: ${process.env.APP_URL}/inbox/${message.bookingId}`,
      });

      await prisma.message.update({
        where: { id: message.id },
        data: { reminderSentAt: now },
      });

      reminded++;
    }

    // Sequential processing for rate limiting
    for (const message of needsLeadReminder) {
      await notifyHost({
        to: message.lead.owner.email,
        subject: `Reminder: Enquiry needs your attention`,
        text: `${message.hostSummary}\n\nOpen: ${process.env.APP_URL}/leads/${message.leadId}`,
      });

      await prisma.leadMessage.update({
        where: { id: message.id },
        data: { reminderSentAt: now },
      });

      reminded++;
    }

    revalidatePath("/inbox");
    revalidatePath("/leads");

    return { reminded, bookingReminders: needsReminder.length, leadReminders: needsLeadReminder.length };
  });
  return result;
};

export const selfCheckJob = async (): Promise<Record<string, number>> => {
  const { withJobRun } = await import("./job-run");
  const result = await withJobRun("self-check", async () => {
    const { prisma } = await import("./db");
    const { notifyHost } = await import("./notify");
    const { revalidatePath } = await import("next/cache");
    const { linkState } = await import("./export-feeds");

    const OPERATOR_EMAIL = process.env.OPERATOR_EMAIL;
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

    // Check export feeds for stale or waiting links
    const exportFeeds = await prisma.exportFeed.findMany({
      where: { enabled: true },
      include: { apartment: true },
    });
    const staleHours = Number(process.env.EXPORT_STALE_AFTER_HOURS ?? 48);
    for (const feed of exportFeeds) {
      const state = linkState(feed, now, staleHours);
      if (state === "STALE") {
        alerts.push(
          `Export feed ${feed.target} for apartment ${feed.apartment.name} (${feed.apartmentId}) is stale (not read for ${staleHours}+ hours)`
        );
      } else if (
        state === "WAITING" &&
        feed.enabledAt &&
        now.getTime() - feed.enabledAt.getTime() > 48 * 60 * 60_000
      ) {
        alerts.push(
          `Export feed ${feed.target} for apartment ${feed.apartment.name} (${feed.apartmentId}) has been waiting for platform to read it for over 48 hours`
        );
      }
    }

    // Check for possible mirror loops
    // Sequential processing: await inside loop is intentional to avoid
    // overwhelming the database with concurrent queries
    for (const feed of exportFeeds) {
      if (!feed.enabledAt) continue;
      const platformBookings = await prisma.booking.findMany({
        where: {
          apartmentId: feed.apartmentId,
          source: feed.target,
          status: "CONFIRMED",
          createdAt: { gt: feed.enabledAt },
        },
        select: { id: true, checkIn: true, checkOut: true },
      });
      for (const pb of platformBookings) {
        const matchingOther = await prisma.booking.count({
          where: {
            apartmentId: feed.apartmentId,
            id: { not: pb.id },
            source: { not: feed.target },
            status: "CONFIRMED",
            checkIn: pb.checkIn,
            checkOut: pb.checkOut,
          },
        });
        if (matchingOther > 0) {
          alerts.push(
            `Possible mirror from ${feed.target} for apartment ${feed.apartment.name} (${feed.apartmentId}); check docs/EXPORT_TEST.md; consider turning the link off`
          );
          break;
        }
      }
    }

    // Check if this is a new alert state
    const lastRun = await prisma.jobRun.findFirst({
      where: { job: "self-check", ok: true },
      orderBy: { startedAt: "desc" },
    });
    const wasOk = lastRun && !lastRun.summary?.includes("alerts");
    const isDegraded = alerts.length > 0;

    if (isDegraded && (wasOk || !lastRun)) {
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
  return result;
};

export const leadFollowUpsJob = async (): Promise<Record<string, number>> => {
  const { withJobRun } = await import("./job-run");
  const result = await withJobRun("lead-follow-ups", async () => {
    const hours = Number(process.env.LEAD_FOLLOW_UP_AFTER_HOURS ?? 16);
    const { processed, sent, skipped } = await processLeadFollowUps(hours);
    return {
      processed,
      sent,
      skipped,
      hours,
    };
  });
  return result;
};

export const syncApprovalsJob = async (): Promise<Record<string, number>> => {
  await syncApprovals();
  return { success: 1 };
};

export const retentionJob = async (): Promise<Record<string, number>> => {
  const result = await runRetention(new Date(), false);
  return result;
};

export const weeklySummaryJob = async (): Promise<Record<string, number>> => {
  const { withJobRun } = await import("./job-run");
  const result = await withJobRun("weekly-summary", async () => {
    const { prisma } = await import("./db");
    const { notifyHost } = await import("./notify");
    const { reportError } = await import("./report-error");

    const now = new Date();
    const currentIsoWeek = getIsoWeekString(now);

    const owners = await prisma.owner.findMany({
      where: { weeklySummaryEnabled: true },
      select: { id: true, email: true, lastSummaryWeek: true },
    });

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    // Sequential processing: await inside loop is intentional for rate limiting
    // email notifications and to avoid overwhelming the mail server
    for (const owner of owners) {
      if (owner.lastSummaryWeek === currentIsoWeek) {
        skipped++;
        continue;
      }

      try {
        const summary = await buildWeeklySummary(owner.id, now);

        await notifyHost({
          to: owner.email,
          subject: summary.subject,
          text: summary.text,
        });

        await prisma.owner.update({
          where: { id: owner.id },
          data: { lastSummaryWeek: currentIsoWeek },
        });

        sent++;
      } catch (e) {
        reportError(e, { ownerId: owner.id, job: "weekly-summary" });
        failed++;
      }
    }

    return {
      owners: owners.length,
      sent,
      skipped,
      failed,
    };
  });
  return result;
};

async function checkStaleJobs(now: Date): Promise<string[]> {
  const { prisma } = await import("./db");
  const stale: string[] = [];

  // Check if tick itself has not run (no JobRun for any job in 5 minutes)
  const latestAnyJob = await prisma.jobRun.findFirst({
    orderBy: { startedAt: "desc" },
  });
  if (!latestAnyJob || new Date(now.getTime() - 5 * 60_000) > latestAnyJob.startedAt) {
    stale.push("tick");
  }

  // Check individual job staleness (twice their interval)
  const thresholds: Record<string, number> = {
    "sync-calendars": 60 * 60_000, // 2x 30 minutes
    "send-scheduled": 10 * 60_000, // 2x 5 minutes
    "escalation-reminders": 30 * 60_000, // 2x 15 minutes
    "sync-templates": 120 * 60_000, // 2x 60 minutes
    "retention": 72 * 60 * 60_000, // 2x 36 hours
    "inbound-recovery": 10 * 60_000, // 2x 5 minutes
    "weekly-summary": 16 * 24 * 60 * 60_000, // 2x 8 days
    "lead-follow-ups": 30 * 60_000, // 2x 15 minutes
    "self-check": 30 * 60_000, // 2x 15 minutes
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

export const JOBS: JobDef[] = [
  { name: "send-scheduled", every: 5, run: sendDueMessagesJob },
  { name: "inbound-recovery", every: 5, run: inboundRecoveryJob },
  { name: "sync-calendars", every: 30, run: syncAllFeedsJob, maxDuration: 20 },
  { name: "escalation-reminders", every: 15, run: escalationRemindersJob },
  { name: "self-check", every: 15, run: selfCheckJob },
  { name: "lead-follow-ups", every: 15, run: leadFollowUpsJob },
  { name: "sync-templates", every: 60, run: syncApprovalsJob },
  { name: "retention", at: { hourUtc: 1, minute: 30 }, run: retentionJob, maxDuration: 20 },
  { name: "weekly-summary", at: { hourUtc: 6, minute: 0, weekdayUtc: 1 }, run: weeklySummaryJob },
];
