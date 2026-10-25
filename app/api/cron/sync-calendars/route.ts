import { NextResponse } from "next/server";
import { syncAllFeeds } from "@/lib/sync";
import { requireCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;
  const results = await syncAllFeeds();
  return NextResponse.json({
    feeds: results.length,
    failed: results.filter((r) => !r.ok).length,
    created: results.reduce((n, r) => n + r.created, 0),
    updated: results.reduce((n, r) => n + r.updated, 0),
    cancelled: results.reduce((n, r) => n + r.cancelled, 0),
  });
}
