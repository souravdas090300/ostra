import { NextResponse } from "next/server";
import { syncApprovals } from "@/lib/template-approval";
import { requireCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;
  await syncApprovals();
  return NextResponse.json({ success: true });
}
