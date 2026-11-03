import { recordUsage } from "./usage";
import {
  sendMetaTextMessage,
  sendMetaTemplateMessage,
  whatsappMode as metaWhatsappMode,
  WhatsAppError as MetaWhatsAppError,
  type WhatsAppMode,
} from "./meta-whatsapp";

type UsageKind = "AI_REPLY" | "AI_TRANSLATE" | "AI_TEMPLATE" | "AI_ENQUIRY" | "WA_TEMPLATE" | "WA_FREEFORM";

export { WhatsAppMode, whatsappMode as metaWhatsappMode };

export const whatsappMode = (): WhatsAppMode => metaWhatsappMode();

export class WhatsAppError extends Error {
  constructor(message: string, public permanent: boolean, public code?: number, public kind?: string) {
    super(message);
  }
}

export type SendInput = {
  to: string; // E.164
  text: string; // rendered text (used for free-form and for our own record)
  template?: { name: string; languageCode: string; components?: Array<{ type: string; parameters: Array<{ type: string; text: string }> }> };
  ownerId?: string;
  kind?: UsageKind;
};

/** Returns the Meta message ID, or null in dry-run. Throws WhatsAppError. */
export async function sendWhatsApp(input: SendInput): Promise<{ sid: string | null }> {
  const mode = whatsappMode();
  if (mode === "dry-run") {
    // Record usage even in dry-run mode for accurate tracking
    if (input.ownerId && input.kind) {
      await recordUsage(input.ownerId, input.kind);
    }
    return { sid: null };
  }

  if (mode === "sandbox") {
    const allowedRecipients = (process.env.META_SANDBOX_ALLOWED_NUMBERS ?? "")
      .split(",")
      .map((number) => number.trim())
      .filter(Boolean);
    if (!allowedRecipients.includes(input.to)) {
      throw new WhatsAppError(
        "Recipient is not on the WhatsApp sandbox allow-list.",
        true,
        undefined,
        "SANDBOX",
      );
    }
  }

  const from = process.env.META_PHONE_NUMBER_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;
  const apiVersion = process.env.META_API_VERSION;

  if (!from || !accessToken || !apiVersion || !/^v\d+\.\d+$/.test(apiVersion)) {
    throw new WhatsAppError(
      "META_PHONE_NUMBER_ID, META_ACCESS_TOKEN and a valid META_API_VERSION are required.",
      true,
    );
  }

  try {
    let result;

    if (input.template) {
      // Send template message
      result = await sendMetaTemplateMessage({
        to: input.to.replace(/^\+/, ""), // Remove + if present
        from,
        templateName: input.template.name,
        languageCode: input.template.languageCode,
        components: input.template.components,
        accessToken,
      });
    } else {
      // Send text message
      result = await sendMetaTextMessage({
        to: input.to.replace(/^\+/, ""), // Remove + if present
        from,
        text: input.text,
        accessToken,
      });
    }

    // Record usage after successful send
    if (input.ownerId && input.kind) {
      await recordUsage(input.ownerId, input.kind);
    }

    return { sid: result.messageId };
  } catch (e) {
    if (e instanceof MetaWhatsAppError) {
      throw new WhatsAppError(e.message, e.permanent, e.code);
    }
    throw new WhatsAppError("WhatsApp send failed", false);
  }
}
