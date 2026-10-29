import { prisma } from "./db";
import { validateTemplate, toMetaBody, hashSource } from "./templates";
import { whatsappMode } from "./whatsapp";
import { log } from "./log";

const TEMPLATE_CATEGORY: Record<string, string> = {
  PRE_ARRIVAL: "MARKETING",
  CHECK_IN: "UTILITY",
  CHECK_OUT: "UTILITY",
  REVIEW_REQUEST: "MARKETING",
};

const SAMPLE: Record<string, string> = {
  guestName: "Anna",
  apartmentName: "Seaview Apartment",
  checkInDate: "10 January 2026",
  checkInTime: "14:00",
  checkOutTime: "11:00",
  reviewUrl: "https://example.com/review",
};

/**
 * Map Ostra language codes to WhatsApp locale codes.
 */
const WHATSAPP_LOCALE_MAP: Record<string, string> = {
  en: "en",
  de: "de",
  fr: "fr",
  es: "es",
  it: "it",
  ar: "ar",
  pt: "pt_PT",
  nl: "nl",
  pl: "pl",
  ru: "ru",
  tr: "tr",
};

function toWhatsAppLocale(code: string): string {
  return WHATSAPP_LOCALE_MAP[code] ?? code;
}

const graphApiUrl = (path: string) => {
  const version = process.env.META_API_VERSION || "v18.0";
  return `https://graph.facebook.com/${version}/${path}`;
};

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

  const { body, order } = toMetaBody(translation.body);
  const locale = toWhatsAppLocale(translation.language);
  const category = TEMPLATE_CATEGORY[translation.template.type];
  const name = `ostra_${translation.template.type.toLowerCase()}_${translation.language}_${hashSource(translation.body)}`;

  try {
    const response = await fetch(graphApiUrl(`${process.env.META_WABA_ID}/message_templates`), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.META_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        language: locale,
        category,
        components: [{
          type: "BODY",
          text: body,
          ...(order.length ? { example: { body_text: [order.map(v => SAMPLE[v] ?? "Example")] } } : {}),
        }],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Meta API error: ${error}`);
    }

    const result = await response.json();
    
    await prisma.templateTranslation.update({
      where: { id: translationId },
      data: {
        metaTemplateName: name,
        metaTemplateId: result.id,
        metaCategory: result.category,
        approval: "PENDING",
      },
    });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("language")) {
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

  const response = await fetch(graphApiUrl(`${process.env.META_WABA_ID}/message_templates?fields=name,status,language,category,id,rejected_reason`), {
    headers: {
      "Authorization": `Bearer ${process.env.META_ACCESS_TOKEN}`,
    },
  });

  if (!response.ok) {
    log("error", "template_sync_failed", { status: response.status });
    return;
  }

  const result = await response.json();
  const metaTemplates = result.data || [];

  for (const t of pending) {
    try {
      if (!t.metaTemplateName) continue;

      const meta = metaTemplates.find((mt: any) => mt.name === t.metaTemplateName);
      if (!meta) continue;

      let newApproval = t.approval;
      let rejectionReason = t.rejectionReason;

      if (meta.status === "APPROVED") {
        newApproval = "APPROVED";
        rejectionReason = null;
      } else if (meta.status === "REJECTED") {
        newApproval = "REJECTED";
        rejectionReason = meta.rejected_reason || "Rejected by WhatsApp";
      }
      // PENDING and other statuses stay as-is

      if (newApproval !== t.approval || rejectionReason !== t.rejectionReason) {
        await prisma.templateTranslation.update({
          where: { id: t.id },
          data: {
            approval: newApproval,
            rejectionReason,
          },
        });
      }
    } catch (e) {
      // Log but continue - one bad row shouldn't break the whole sync
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

  // If already approved, create a new version instead of editing
  if (translation.approval === "APPROVED") {
    await prisma.templateTranslation.create({
      data: {
        templateId: translation.templateId,
        language: translation.language,
        body: newBody,
        sourceHash: hashSource(newBody),
        editedByHost: true,
        approval: "NONE",
        rejectionReason: null,
      },
    });
    return;
  }

  await prisma.templateTranslation.update({
    where: { id: translationId },
    data: {
      body: newBody,
      sourceHash: hashSource(newBody),
      editedByHost: true,
      metaTemplateName: null,
      metaTemplateId: null,
      metaCategory: null,
      approval: "NONE",
      rejectionReason: null,
    },
  });
}
