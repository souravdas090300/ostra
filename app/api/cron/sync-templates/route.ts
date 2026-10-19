import { NextResponse } from "next/server";
import { syncApprovals } from "@/lib/template-approval";
import { cronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await syncApprovals();
  return NextResponse.json({ success: true });
}
