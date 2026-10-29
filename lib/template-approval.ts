import { prisma } from "./db";
import { validateTemplate, toTwilioBody } from "./templates";
import { whatsappMode } from "./whatsapp";
import { log } from "./log";

/**
 * Map Ostra language codes to WhatsApp locale codes.
 * WhatsApp uses a subset of locales; unsupported languages will be rejected.
 */
const WHATSAPP_LOCALE_MAP: Record<string, string> = {
  en: "en",
  de: "de",
  fr: "fr",
  es: "es",
  it: "it",
  ar: "ar",
  pt: "pt",
  nl: "nl",
  pl: "pl",
  ru: "ru",
  tr: "tr",
  // Add more as needed from WhatsApp's supported list
};

function toWhatsAppLocale(code: string): string {
  return WHATSAPP_LOCALE_MAP[code] ?? code;
}

export async function submitTranslation(translationId: string, ownerId: string): Promise<void> {
  const mode = whatsappMode();
  if (mode === "dry-run") {
    throw new Error("Connect your WhatsApp sender first (set WHATSAPP_MODE to sandbox or production)");
  }

  const translation = await prisma.templateTranslation.findUnique({
    where: { id: translationId },
    include: { template: true },
  });

  if (!translation || translation.template.ownerId !== ownerId) {
    throw new Error("Translation not found");
  }

  const errors = validateTemplate(translation.template.type as "PRE_ARRIVAL" | "CHECK_IN" | "CHECK_OUT" | "REVIEW_REQUEST", translation.body);
  if (errors.length > 0) {
    throw new Error(`Template validation failed: ${errors.join(", ")}`);
  }

  const { body, order } = toTwilioBody(translation.body);
  const locale = toWhatsAppLocale(translation.language);

  try {
    // TODO: Implement Meta template submission via Graph API
    // For now, mark as PENDING with placeholder
    await prisma.templateTranslation.update({
      where: { id: translationId },
      data: {
        metaTemplateName: `pending_${translation.template.type}_${translation.language}`,
        approval: "PENDING",
      },
    });
  } catch (e: unknown) {
    // If the language is not supported by WhatsApp, mark as rejected
    if (e instanceof Error && (e.message.includes("language") || ("code" in e && typeof e.code === "number" && e.code === 21612))) {
      await prisma.templateTranslation.update({
        where: { id: translationId },
        data: {
          approval: "REJECTED",
          rejectionReason: "Language not supported by WhatsApp templates",
        },
      });
      throw new Error("Language not supported by WhatsApp templates");
    }
    throw e;
  }
}

export async function syncApprovals(): Promise<void> {
  const pending = await prisma.templateTranslation.findMany({
    where: { approval: "PENDING", metaTemplateName: { not: null } },
    include: { template: true },
  });

  for (const t of pending) {
    try {
      if (!t.metaTemplateName) continue;

      // TODO: Implement Meta template approval check via Graph API
      // For now, keep PENDING status
      continue;
    } catch (e) {
      // Never throw for one bad row; log and continue
      log("error", "template_approval_failed", { translationId: t.id });
    }
  }
}

export async function updateTranslationText(
  translationId: string,
  ownerId: string,
  newBody: string,
): Promise<void> {
  const translation = await prisma.templateTranslation.findUnique({
    where: { id: translationId },
    include: { template: true },
  });

  if (!translation || translation.template.ownerId !== ownerId) {
    throw new Error("Translation not found");
  }

  // If already approved, cannot edit
  if (translation.approval === "APPROVED") {
    throw new Error("Cannot edit an approved template. Create a new translation instead.");
  }

  await prisma.templateTranslation.update({
    where: { id: translationId },
    data: {
      body: newBody,
      metaTemplateName: null,
      approval: "NONE",
      rejectionReason: null,
    },
  });
}
