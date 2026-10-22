import { NextResponse } from "next/server";
import { sendEscalationReminders } from "@/lib/reminders";
import { cronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const summary = await sendEscalationReminders();
  return NextResponse.json(summary);
}
