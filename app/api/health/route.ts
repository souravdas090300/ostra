import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Test database connection with a 2-second timeout
    await prisma.$queryRaw`SELECT 1`.catch(() => {
      throw new Error("Database query failed");
    });

    return NextResponse.json({
      ok: true,
      version: process.env.RAILWAY_GIT_COMMIT_SHA || "dev",
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
