"use server";

import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { hashSource } from "@/lib/templates";
import { submitTranslation, updateTranslationText } from "@/lib/template-approval";
import { translateTemplate } from "@/lib/translate";
import { rescheduleBookings } from "@/lib/schedule";
import { revalidatePath } from "next/cache";

export async function POST(formData: FormData) {
  const action = formData.get("action") as string;

  switch (action) {
    case "updateTemplate":
      return updateTemplate(formData);
    case "add":
      return addTranslation(formData);
    case "edit":
      return editTranslation(formData);
    case "regenerate":
      return regenerateTranslation(formData);
    case "submit":
      return submitForApproval(formData);
    case "sync":
      return syncApprovals();
    case "remove":
      return removeTranslation(formData);
    case "updateFallback":
      return updateFallbackLanguage(formData);
    default:
      // Legacy: treat as updateTemplate if no action specified
      if (formData.get("templateId")) {
        return updateTemplate(formData);
      }
      throw new Error("Invalid action");
  }
}

export async function updateTemplate(formData: FormData) {
  const session = await requireOwner();
  const ownerId = session.id;

  const templateId = formData.get("templateId") as string;
  const body = formData.get("body") as string;
  const enabled = formData.get("enabled") === "true";

  const template = await prisma.messageTemplate.findUnique({
    where: { id: templateId },
  });

  if (!template || template.ownerId !== ownerId) {
    throw new Error("Template not found");
  }

  await prisma.messageTemplate.update({
    where: { id: templateId },
    data: { body, enabled },
  });

  // Update the host language translation
  const hostTranslation = await prisma.templateTranslation.findUnique({
    where: {
      templateId_language: { templateId, language: template.ownerId },
    },
  });

  if (hostTranslation) {
    await prisma.templateTranslation.update({
      where: { id: hostTranslation.id },
      data: {
        body,
        sourceHash: hashSource(body),
        approval: "NONE",
        metaTemplateName: null,
        rejectionReason: null,
      },
    });
  }

  // Mark other translations as stale by setting sourceHash to empty
  await prisma.templateTranslation.updateMany({
    where: {
      templateId,
      language: { not: template.ownerId },
    },
    data: {
      sourceHash: "",
    },
  });

  // Reschedule bookings when template changes
  const bookings = await prisma.booking.findMany({
    where: {
      apartment: { ownerId },
      status: "CONFIRMED",
      checkIn: { gte: new Date() },
    },
    select: { id: true },
  });
  await rescheduleBookings(bookings.map((b) => b.id));
  revalidatePath("/settings/messages");
}

export async function addTranslation(formData: FormData) {
  const session = await requireOwner();
  const ownerId = session.id;

  const templateId = formData.get("templateId") as string;
  const language = formData.get("language") as string;

  const template = await prisma.messageTemplate.findUnique({
    where: { id: templateId },
    include: { owner: true },
  });

  if (!template || template.ownerId !== ownerId) {
    throw new Error("Template not found");
  }

  // Auto-translate using AI
  const translatedBody = await translateTemplate(
    template.type as "PRE_ARRIVAL" | "CHECK_IN" | "CHECK_OUT" | "REVIEW_REQUEST",
    template.body,
    template.owner.hostLanguage,
    language,
  );

  await prisma.templateTranslation.create({
    data: {
      templateId,
      language,
      body: translatedBody,
      sourceHash: hashSource(template.body),
    },
  });
  revalidatePath("/settings/messages");
}

export async function editTranslation(formData: FormData) {
  const session = await requireOwner();
  const ownerId = session.id;

  const translationId = formData.get("translationId") as string;
  const body = formData.get("body") as string;

  await updateTranslationText(translationId, ownerId, body);
  revalidatePath("/settings/messages");
}

export async function regenerateTranslation(formData: FormData) {
  const session = await requireOwner();
  const ownerId = session.id;

  const templateId = formData.get("templateId") as string;
  const language = formData.get("language") as string;

  const template = await prisma.messageTemplate.findUnique({
    where: { id: templateId },
    include: { translations: true, owner: true },
  });

  if (!template || template.ownerId !== ownerId) {
    throw new Error("Template not found");
  }

  const translation = template.translations.find((t) => t.language === language);
  if (!translation || translation.editedByHost) {
    throw new Error("Cannot regenerate edited translations");
  }

  const translatedBody = await translateTemplate(
    template.type as "PRE_ARRIVAL" | "CHECK_IN" | "CHECK_OUT" | "REVIEW_REQUEST",
    template.body,
    template.owner.hostLanguage,
    language,
  );

  await prisma.templateTranslation.update({
    where: { id: translation.id },
    data: {
      body: translatedBody,
      sourceHash: hashSource(template.body),
      approval: "NONE",
      metaTemplateName: null,
      rejectionReason: null,
    },
  });
  revalidatePath("/settings/messages");
}

export async function submitForApproval(formData: FormData) {
  const session = await requireOwner();
  const ownerId = session.id;

  const translationId = formData.get("translationId") as string;

  await submitTranslation(translationId, ownerId);
  revalidatePath("/settings/messages");
}

export async function syncApprovals() {
  const session = await requireOwner();
  const ownerId = session.id;

  // Only sync this owner's templates
  const pending = await prisma.templateTranslation.findMany({
    where: {
      approval: "PENDING",
      metaTemplateName: { not: null },
      template: { ownerId },
    },
  });

  if (pending.length === 0) return;

  const { syncApprovals: sync } = await import("@/lib/template-approval");
  await sync();
  revalidatePath("/settings/messages");
}

export async function removeTranslation(formData: FormData) {
  const session = await requireOwner();
  const ownerId = session.id;

  const translationId = formData.get("translationId") as string;

  const translation = await prisma.templateTranslation.findUnique({
    where: { id: translationId },
    include: { template: { include: { owner: true } } },
  });

  if (!translation || translation.template.ownerId !== ownerId) {
    throw new Error("Translation not found");
  }

  if (translation.language === translation.template.owner.hostLanguage) {
    throw new Error("Cannot remove host language translation");
  }

  await prisma.templateTranslation.delete({
    where: { id: translationId },
  });
  revalidatePath("/settings/messages");
}

export async function updateFallbackLanguage(formData: FormData) {
  const session = await requireOwner();
  const ownerId = session.id;

  const fallbackLanguage = formData.get("fallbackLanguage") as string;

  await prisma.owner.update({
    where: { id: ownerId },
    data: { fallbackLanguage },
  });
  revalidatePath("/settings/messages");
}
