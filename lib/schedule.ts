import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { planSend } from "./send-time";
import { DEFAULT_TEMPLATES, hashSource } from "./templates";

const TYPES: ("PRE_ARRIVAL" | "CHECK_IN" | "CHECK_OUT" | "REVIEW_REQUEST")[] = [
  "PRE_ARRIVAL",
  "CHECK_IN",
  "CHECK_OUT",
  "REVIEW_REQUEST",
];

/** Creates the owner's four templates (English defaults) and the host-language row if missing. */
export async function ensureDefaultTemplates(ownerId: string, hostLanguage: string) {
  for (const type of TYPES) {
    const t = await prisma.messageTemplate.upsert({
      where: { ownerId_type: { ownerId, type } },
      update: {},
      create: { ownerId, type, body: DEFAULT_TEMPLATES[type] },
    });
    await prisma.templateTranslation.upsert({
      where: { templateId_language: { templateId: t.id, language: hostLanguage } },
      update: {},
      create: { templateId: t.id, language: hostLanguage, body: t.body, sourceHash: hashSource(t.body) },
    });
  }
}

export async function rescheduleBookings(ids: string[], now = new Date()): Promise<void> {
  if (ids.length === 0) return;
  const bookings = await prisma.booking.findMany({
    where: { id: { in: ids } },
    include: { apartment: { include: { owner: { include: { templates: true } } } } },
  });
  for (const b of bookings) {
    if (b.apartment.owner.templates.length === 0) {
      await ensureDefaultTemplates(b.apartment.ownerId, b.apartment.owner.hostLanguage);
    }
    await rescheduleOne(b.id, now);
  }
}

async function rescheduleOne(bookingId: string, now: Date) {
  const b = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      scheduled: true,
      apartment: { include: { owner: { include: { templates: true } } } },
    },
  });
  if (!b) return;

  const eligible =
    !b.isBlock &&
    b.status === "CONFIRMED" &&
    !!b.guestPhone &&
    !!b.optedInAt &&
    !b.optedOutAt &&
    !b.messagesPaused;

  if (!eligible) {
    // Cancel what has not been sent. SENT and SENDING rows are never touched.
    await prisma.scheduledMessage.updateMany({
      where: {
        bookingId,
        status: { in: ["PENDING", "SKIPPED"] },
        hostSkipped: false,
      },
      data: { status: "CANCELLED", skipReason: "Booking not eligible for messages" },
    });
    return;
  }

  for (const type of TYPES) {
    const template = b.apartment.owner.templates.find((t) => t.type === type);
    if (!template || !template.enabled) continue;
    const row = b.scheduled.find((s) => s.type === type);
    if (row && (row.status === "SENT" || row.status === "SENDING" || row.hostSkipped)) continue;

    const plan =
      type === "REVIEW_REQUEST" && !b.apartment.reviewUrl
        ? { skip: "No review link set for this apartment." }
        : planSend(type, b, now);

    if ("skip" in plan) {
      const data: Prisma.ScheduledMessageUncheckedUpdateInput = {
        status: "SKIPPED",
        skipReason: plan.skip,
      };
      if (row) {
        if (row.status !== "SKIPPED" || row.skipReason !== plan.skip)
          await prisma.scheduledMessage.update({ where: { id: row.id }, data });
      } else
        await prisma.scheduledMessage.create({
          data: { bookingId, type, sendAt: now, status: "SKIPPED", skipReason: plan.skip },
        });
      continue;
    }

    if (!row) {
      await prisma.scheduledMessage.create({
        data: { bookingId, type, sendAt: plan.sendAt, status: "PENDING" },
      });
    } else if (row.status === "FAILED" && row.sendAt.getTime() === plan.sendAt.getTime()) {
      continue; // failed for this exact moment: do not retry silently
    } else if (row.status !== "PENDING" || row.sendAt.getTime() !== plan.sendAt.getTime()) {
      await prisma.scheduledMessage.update({
        where: { id: row.id },
        data: {
          status: "PENDING",
          sendAt: plan.sendAt,
          attempts: 0,
          lastError: null,
          skipReason: null,
          claimedAt: null,
        },
      });
    }
  }
}
