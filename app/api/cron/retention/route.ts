import { withJobRun } from "@/lib/job-run";
import { runRetention } from "@/lib/retention";
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";

export async function POST(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";

  const result = await withJobRun("retention", async () => {
    return await runRetention(new Date(), dryRun);
  });

  return NextResponse.json(result);
}
