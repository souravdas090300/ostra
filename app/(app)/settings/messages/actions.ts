"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LANGUAGE_CODES } from "@/lib/languages";
import { reportError } from "@/lib/report-error";
import { rescheduleBookings } from "@/lib/schedule";
import {
  submitTranslation,
  syncApprovals,
  TemplateApprovalError,
  updateTranslationText,
} from "@/lib/template-approval";
import { hashSource, validateTemplate, type MessageType } from "@/lib/templates";
import { translateTemplate } from "@/lib/translate";
import { whatsappMode } from "@/lib/whatsapp";

export type MessagesActionState = { ok?: true; error?: string } | undefined;

const idSchema = z.string().trim().min(1, "Choose a template or translation.").max(100);
const languageSchema = z.string().refine(
  (language) => LANGUAGE_CODES.includes(language),
  "Choose a supported language.",
);
const templateSchema = z.object({
  templateId: idSchema,
  body: z.string().max(1024, "The message is longer than 1024 characters."),
  enabled: z.enum(["true", "false"]),
});
const translationSchema = z.object({ translationId: idSchema });
const addTranslationSchema = z.object({
  templateId: idSchema,
  language: languageSchema,
});
const editTranslationSchema = z.object({
  translationId: idSchema,
  body: z.string().max(1024, "The message is longer than 1024 characters."),
});
const regenerateSchema = z.object({
  templateId: idSchema,
  language: languageSchema,
});
const fallbackSchema = z.object({ fallbackLanguage: languageSchema });
const emptyActionSchema = z.object({}).strict();
const enquiriesSchema = z.object({ enabled: z.enum(["true", "false"]) });

function formValue(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function validationError(error: z.ZodError): MessagesActionState {
  return { error: error.issues[0]?.message ?? "Check the submitted values." };
}

function actionError(error: unknown, fallback: string): MessagesActionState {
  if (error instanceof TemplateApprovalError) return { error: error.message };
  if (error instanceof z.ZodError) return validationError(error);
  reportError(error, { area: "messages-settings" });
  return { error: fallback };
}

export async function saveTemplateAction(
  _previousState: MessagesActionState,
  formData: FormData,
): Promise<MessagesActionState> {
  const owner = await requireOwner();
  const parsed = templateSchema.safeParse({
    templateId: formValue(formData, "templateId"),
    body: formValue(formData, "body"),
    enabled: formValue(formData, "enabled"),
  });
  if (!parsed.success) return validationError(parsed.error);

  try {
    const template = await prisma.messageTemplate.findFirst({
      where: { id: parsed.data.templateId, ownerId: owner.id },
      include: { owner: { select: { hostLanguage: true } } },
    });
    if (!template) return { error: "Template not found." };

    const validationErrors = validateTemplate(template.type as MessageType, parsed.data.body);
    if (validationErrors.length) return { error: validationErrors.join(" ") };

    const enabled = parsed.data.enabled === "true";
    const bodyChanged = template.body !== parsed.data.body;
    await prisma.$transaction(async (tx) => {
      await tx.messageTemplate.update({
        where: { id: template.id },
        data: { body: parsed.data.body, enabled },
      });

      if (bodyChanged) {
        const hostTranslation = await tx.templateTranslation.findFirst({
          where: { templateId: template.id, language: template.owner.hostLanguage },
          orderBy: { revision: "desc" },
          select: { body: true, revision: true },
        });
        if (hostTranslation?.body !== parsed.data.body) {
          await tx.templateTranslation.create({
            data: {
              templateId: template.id,
              language: template.owner.hostLanguage,
              body: parsed.data.body,
              sourceHash: hashSource(parsed.data.body),
              revision: (hostTranslation?.revision ?? 0) + 1,
            },
          });
        }
      }
    });

    if (bodyChanged || enabled !== template.enabled) {
      const bookings = await prisma.booking.findMany({
        where: {
          apartment: { ownerId: owner.id },
          status: "CONFIRMED",
          checkIn: { gte: new Date() },
        },
        select: { id: true },
      });
      await rescheduleBookings(bookings.map((booking) => booking.id));
    }

    revalidatePath("/settings/messages");
    return { ok: true };
  } catch (error) {
    return actionError(error, "Could not save this message template.");
  }
}

export async function addTranslationAction(
  _previousState: MessagesActionState,
  formData: FormData,
): Promise<MessagesActionState> {
  const owner = await requireOwner();
  const parsed = addTranslationSchema.safeParse({
    templateId: formValue(formData, "templateId"),
    language: formValue(formData, "language"),
  });
  if (!parsed.success) return validationError(parsed.error);

  try {
    const template = await prisma.messageTemplate.findFirst({
      where: { id: parsed.data.templateId, ownerId: owner.id },
      include: { owner: { select: { hostLanguage: true } } },
    });
    if (!template) return { error: "Template not found." };
    if (parsed.data.language === template.owner.hostLanguage) {
      return { error: "The host language already has a source template." };
    }
    const existing = await prisma.templateTranslation.findFirst({
      where: { templateId: template.id, language: parsed.data.language },
      select: { id: true },
    });
    if (existing) return { error: "A translation for this language already exists." };

    const translatedBody = await translateTemplate(
      template.type as MessageType,
      template.body,
      template.owner.hostLanguage,
      parsed.data.language,
    );
    const validationErrors = validateTemplate(template.type as MessageType, translatedBody);
    if (validationErrors.length) return { error: validationErrors.join(" ") };
    await prisma.templateTranslation.create({
      data: {
        templateId: template.id,
        language: parsed.data.language,
        body: translatedBody,
        sourceHash: hashSource(template.body),
        revision: 1,
      },
    });
    revalidatePath("/settings/messages");
    return { ok: true };
  } catch (error) {
    return actionError(error, "Could not add this translation.");
  }
}

export async function editTranslationAction(
  _previousState: MessagesActionState,
  formData: FormData,
): Promise<MessagesActionState> {
  const owner = await requireOwner();
  const parsed = editTranslationSchema.safeParse({
    translationId: formValue(formData, "translationId"),
    body: formValue(formData, "body"),
  });
  if (!parsed.success) return validationError(parsed.error);

  try {
    await updateTranslationText(parsed.data.translationId, owner.id, parsed.data.body);
    revalidatePath("/settings/messages");
    return { ok: true };
  } catch (error) {
    return actionError(error, "Could not save this translation.");
  }
}

export async function regenerateTranslationAction(
  _previousState: MessagesActionState,
  formData: FormData,
): Promise<MessagesActionState> {
  const owner = await requireOwner();
  const parsed = regenerateSchema.safeParse({
    templateId: formValue(formData, "templateId"),
    language: formValue(formData, "language"),
  });
  if (!parsed.success) return validationError(parsed.error);

  try {
    const template = await prisma.messageTemplate.findFirst({
      where: { id: parsed.data.templateId, ownerId: owner.id },
      include: { owner: { select: { hostLanguage: true } } },
    });
    if (!template) return { error: "Template not found." };

    const translation = await prisma.templateTranslation.findFirst({
      where: { templateId: template.id, language: parsed.data.language },
      orderBy: { revision: "desc" },
    });
    if (!translation || translation.editedByHost) {
      return { error: "This translation cannot be regenerated." };
    }

    const translatedBody = await translateTemplate(
      template.type as MessageType,
      template.body,
      template.owner.hostLanguage,
      parsed.data.language,
    );
    const validationErrors = validateTemplate(template.type as MessageType, translatedBody);
    if (validationErrors.length) return { error: validationErrors.join(" ") };
    await prisma.templateTranslation.create({
      data: {
        templateId: template.id,
        language: parsed.data.language,
        body: translatedBody,
        sourceHash: hashSource(template.body),
        revision: translation.revision + 1,
      },
    });
    revalidatePath("/settings/messages");
    return { ok: true };
  } catch (error) {
    return actionError(error, "Could not regenerate this translation.");
  }
}

export async function submitForApprovalAction(
  _previousState: MessagesActionState,
  formData: FormData,
): Promise<MessagesActionState> {
  const owner = await requireOwner();
  const parsed = translationSchema.safeParse({
    translationId: formValue(formData, "translationId"),
  });
  if (!parsed.success) return validationError(parsed.error);

  try {
    await submitTranslation(parsed.data.translationId, owner.id);
    revalidatePath("/settings/messages");
    return { ok: true };
  } catch (error) {
    return actionError(error, "Could not submit this translation to Meta.");
  }
}

export async function refreshApprovalsAction(
  _previousState: MessagesActionState,
  _formData: FormData,
): Promise<MessagesActionState> {
  const owner = await requireOwner();
  if (!emptyActionSchema.safeParse(Object.fromEntries(_formData)).success) {
    return { error: "Unexpected settings were submitted." };
  }
  if (whatsappMode() === "dry-run") {
    return { error: "Connect your WhatsApp sender first by selecting sandbox or production mode." };
  }
  try {
    await syncApprovals(owner.id);
    revalidatePath("/settings/messages");
    return { ok: true };
  } catch (error) {
    return actionError(error, "Could not refresh template approval status.");
  }
}

export async function removeTranslationAction(
  _previousState: MessagesActionState,
  formData: FormData,
): Promise<MessagesActionState> {
  const owner = await requireOwner();
  const parsed = translationSchema.safeParse({
    translationId: formValue(formData, "translationId"),
  });
  if (!parsed.success) return validationError(parsed.error);

  try {
    const translation = await prisma.templateTranslation.findFirst({
      where: { id: parsed.data.translationId, template: { ownerId: owner.id } },
      include: { template: { include: { owner: { select: { hostLanguage: true } } } } },
    });
    if (!translation) return { error: "Translation not found." };
    if (translation.language === translation.template.owner.hostLanguage) {
      return { error: "The host language translation cannot be removed." };
    }
    const latest = await prisma.templateTranslation.findFirst({
      where: { templateId: translation.templateId, language: translation.language },
      orderBy: { revision: "desc" },
      select: { id: true },
    });
    if (latest?.id !== translation.id) {
      return { error: "Only the latest translation version can be removed." };
    }
    await prisma.templateTranslation.deleteMany({
      where: { templateId: translation.templateId, language: translation.language },
    });
    revalidatePath("/settings/messages");
    return { ok: true };
  } catch (error) {
    return actionError(error, "Could not remove this translation.");
  }
}

export async function updateFallbackLanguageAction(
  _previousState: MessagesActionState,
  formData: FormData,
): Promise<MessagesActionState> {
  const owner = await requireOwner();
  const parsed = fallbackSchema.safeParse({
    fallbackLanguage: formValue(formData, "fallbackLanguage"),
  });
  if (!parsed.success) return validationError(parsed.error);

  try {
    await prisma.owner.update({
      where: { id: owner.id },
      data: { fallbackLanguage: parsed.data.fallbackLanguage },
    });
    revalidatePath("/settings/messages");
    return { ok: true };
  } catch (error) {
    return actionError(error, "Could not save the fallback language.");
  }
}

export async function setEnquiriesEnabledAction(
  _previousState: MessagesActionState,
  formData: FormData,
): Promise<MessagesActionState> {
  const owner = await requireOwner();
  const parsed = enquiriesSchema.safeParse({
    enabled: formValue(formData, "enabled"),
  });
  if (!parsed.success) return validationError(parsed.error);
  try {
    const updated = await prisma.owner.updateMany({
      where: { id: owner.id },
      data: { enquiriesEnabled: parsed.data.enabled === "true" },
    });
    if (updated.count !== 1) return { error: "Owner not found." };
    revalidatePath("/settings/messages");
    revalidatePath("/settings/enquiries");
    return { ok: true };
  } catch (error) {
    return actionError(error, "Could not update the enquiries setting.");
  }
}
