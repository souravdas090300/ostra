import { prisma } from "./db";
import { validateTemplate, toTwilioBody } from "./templates";
import { whatsappMode } from "./whatsapp";
import twilio from "twilio";

const getClient = () => twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);

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
    // Create content in Twilio
    const client = getClient() as unknown as { content: { create: (data: unknown) => Promise<{ sid: string }> } };
    const content = await client.content.create({
      friendlyName: `ostra_${translation.template.type}_${translation.language}_${translation.sourceHash.slice(0, 8)}`,
      language: locale,
      variables: order.map(() => ({
        type: "text",
        default_value: "Sample",
      })),
      types: {
        "twilio/text": {
          body,
        },
      },
    });

    await prisma.templateTranslation.update({
      where: { id: translationId },
      data: {
        contentSid: content.sid,
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
    where: { approval: "PENDING", contentSid: { not: null } },
    include: { template: true },
  });

  for (const t of pending) {
    try {
      if (!t.contentSid) continue;

      const client = getClient() as unknown as { content: (sid: string) => { fetch: () => Promise<{ whatsapp?: { approvalStatus?: string; rejectionReason?: string } }> } };
      const content = await client.content(t.contentSid).fetch();

      let newApproval = t.approval;
      let rejectionReason = t.rejectionReason;

      // Check the content approval status
      if (content.whatsapp?.approvalStatus === "approved") {
        newApproval = "APPROVED";
        rejectionReason = null;
      } else if (content.whatsapp?.approvalStatus === "rejected") {
        newApproval = "REJECTED";
        rejectionReason = content.whatsapp?.rejectionReason || "Rejected by WhatsApp";
      }
      // Other statuses stay PENDING

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
      // Never throw for one bad row; log and continue
      console.error(`Failed to sync approval for translation ${t.id}:`, e);
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
      contentSid: null,
      approval: "NONE",
      rejectionReason: null,
    },
  });
}
