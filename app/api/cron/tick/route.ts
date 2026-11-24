import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { runTick } from "@/lib/scheduler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;
  const result = await runTick();
  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
