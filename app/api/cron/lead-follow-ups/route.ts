import { prisma } from "@/lib/db";
import { withJobRun } from "@/lib/job-run";
import { reportError } from "@/lib/report-error";
import { processLeadFollowUps } from "@/lib/lead-follow-up";
import { requireCronAuth } from "@/lib/cron-auth";

export async function POST(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

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

  return Response.json(result);
}
