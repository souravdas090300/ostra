import { randomBytes } from "crypto";
import { prisma } from "./db";

export const newExportToken = () => randomBytes(24).toString("base64url");
export const TARGETS = ["AIRBNB", "BOOKING_COM"] as const;

export type LinkState = "DISABLED" | "WAITING" | "CONNECTED" | "STALE";

/** Idempotent. New links start disabled. */
export async function ensureExportFeeds(apartmentId: string) {
  for (const target of TARGETS) {
    await prisma.exportFeed.upsert({
      where: { apartmentId_target: { apartmentId, target } },
      update: {},
      create: { apartmentId, target, token: newExportToken() },
    });
  }
}

export function linkState(
  f: { enabled: boolean; lastFetchedAt: Date | null },
  now = new Date(),
  staleHours = Number(process.env.EXPORT_STALE_AFTER_HOURS ?? 48),
): LinkState {
  if (!f.enabled) return "DISABLED";
  if (!f.lastFetchedAt) return "WAITING";
  return now.getTime() - f.lastFetchedAt.getTime() > staleHours * 3_600_000 ? "STALE" : "CONNECTED";
}
