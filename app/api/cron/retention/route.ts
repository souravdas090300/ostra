import { withJobRun } from "@/lib/job-run";
import { runRetention } from "@/lib/retention";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";

  const result = await withJobRun("retention", async () => {
    return await runRetention(new Date(), dryRun);
  });

  return NextResponse.json(result);
}
