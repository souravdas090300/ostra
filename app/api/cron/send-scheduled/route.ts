import { NextResponse } from "next/server";
import { sendDueMessages } from "@/lib/send-scheduled";
import { requireCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;
  const summary = await sendDueMessages();
  return NextResponse.json(summary);
}
