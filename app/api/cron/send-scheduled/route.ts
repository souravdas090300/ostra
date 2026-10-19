import { NextResponse } from "next/server";
import { sendDueMessages } from "@/lib/send-scheduled";
import { cronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const summary = await sendDueMessages();
  return NextResponse.json(summary);
}
