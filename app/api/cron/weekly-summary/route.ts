import { prisma } from "@/lib/db";
import { withJobRun } from "@/lib/job-run";
import { reportError } from "@/lib/report-error";
import { buildWeeklySummary, getIsoWeekString } from "@/lib/weekly-summary";
import { notifyHost } from "@/lib/notify";
import { requireCronAuth } from "@/lib/cron-auth";

export async function POST(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  const result = await withJobRun("weekly-summary", async () => {
    const now = new Date();
    const currentIsoWeek = getIsoWeekString(now);

    // Get all owners with weekly summary enabled
    const owners = await prisma.owner.findMany({
      where: { weeklySummaryEnabled: true },
      select: { id: true, email: true, lastSummaryWeek: true },
    });

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const owner of owners) {
      // Skip if already sent for this week
      if (owner.lastSummaryWeek === currentIsoWeek) {
        skipped++;
        continue;
      }

      try {
        const summary = await buildWeeklySummary(owner.id, now);

        // Send email
        await notifyHost({
          to: owner.email,
          subject: summary.subject,
          text: summary.text,
        });

        // Set lastSummaryWeek after successful send
        await prisma.owner.update({
          where: { id: owner.id },
          data: { lastSummaryWeek: currentIsoWeek },
        });

        sent++;
      } catch (e) {
        // Log error but continue with other owners
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

  return Response.json(result);
}
