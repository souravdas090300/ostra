"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { newExportToken, TARGETS } from "@/lib/export-feeds";

export type ExportActionResult = { ok?: true; error?: string };

const VALID_TARGETS = new Set(TARGETS);

export async function ensureExportFeeds(apartmentId: string): Promise<void> {
  const session = await requireOwner();
  const apartment = await prisma.apartment.findFirst({
    where: { id: apartmentId, ownerId: session.id },
  });
  if (!apartment) notFound();

  await Promise.all(
    TARGETS.map((target) =>
      prisma.exportFeed.upsert({
        where: { apartmentId_target: { apartmentId, target } },
        update: {},
        create: { apartmentId, target, token: newExportToken() },
      })
    )
  );
}

export async function enableExport(apartmentId: string, target: "AIRBNB" | "BOOKING_COM"): Promise<ExportActionResult> {
  const session = await requireOwner();
  if (!VALID_TARGETS.has(target)) return { error: "Invalid target platform" };

  const { count } = await prisma.exportFeed.updateMany({
    where: { apartmentId, target, apartment: { ownerId: session.id } },
    data: { enabled: true, enabledAt: new Date() },
  });
  if (count === 0) notFound();

  revalidatePath(`/apartments/${apartmentId}`);
  return { ok: true };
}

export async function disableExport(apartmentId: string, target: "AIRBNB" | "BOOKING_COM"): Promise<ExportActionResult> {
  const session = await requireOwner();
  if (!VALID_TARGETS.has(target)) return { error: "Invalid target platform" };

  const { count } = await prisma.exportFeed.updateMany({
    where: { apartmentId, target, apartment: { ownerId: session.id } },
    data: { enabled: false },
  });
  if (count === 0) notFound();

  revalidatePath(`/apartments/${apartmentId}`);
  return { ok: true };
}

export async function confirmExport(apartmentId: string, target: "AIRBNB" | "BOOKING_COM", confirmed: boolean): Promise<ExportActionResult> {
  const session = await requireOwner();
  if (!VALID_TARGETS.has(target)) return { error: "Invalid target platform" };

  const { count } = await prisma.exportFeed.updateMany({
    where: { apartmentId, target, apartment: { ownerId: session.id } },
    data: { confirmedAt: confirmed ? new Date() : null },
  });
  if (count === 0) notFound();

  revalidatePath(`/apartments/${apartmentId}`);
  return { ok: true };
}

export async function regenerateExportToken(apartmentId: string, target: "AIRBNB" | "BOOKING_COM"): Promise<ExportActionResult> {
  const session = await requireOwner();
  if (!VALID_TARGETS.has(target)) return { error: "Invalid target platform" };

  const { count } = await prisma.exportFeed.updateMany({
    where: { apartmentId, target, apartment: { ownerId: session.id } },
    data: {
      token: newExportToken(),
      lastFetchedAt: null,
      fetchCount: 0,
      confirmedAt: null,
      enabledAt: new Date(),
    },
  });
  if (count === 0) notFound();

  revalidatePath(`/apartments/${apartmentId}`);
  return { ok: true };
}
