import { randomBytes } from "crypto";
import { prisma } from "./db";
import { linkState, type LinkState } from "./export-feed-state";

export { linkState, type LinkState };

export const newExportToken = () => randomBytes(24).toString("base64url");
export const TARGETS = ["AIRBNB", "BOOKING_COM"] as const;

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


