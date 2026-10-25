import { recordUsage } from "./usage";
import {
  sendMetaTextMessage,
  sendMetaTemplateMessage,
  whatsappMode as metaWhatsappMode,
  WhatsAppError as MetaWhatsAppError,
  type WhatsAppMode,
} from "./meta-whatsapp";

type UsageKind = "AI_REPLY" | "AI_TRANSLATE" | "AI_TEMPLATE" | "WA_TEMPLATE" | "WA_FREEFORM";

export { WhatsAppMode, whatsappMode as metaWhatsappMode };

export const whatsappMode = (): WhatsAppMode => metaWhatsappMode();

export class WhatsAppError extends Error {
  constructor(message: string, public permanent: boolean, public code?: number) {
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

  const from = process.env.META_WHATSAPP_PHONE_NUMBER_ID!;
  const accessToken = process.env.META_ACCESS_TOKEN!;

  if (!from || !accessToken) {
    throw new WhatsAppError("META_WHATSAPP_PHONE_NUMBER_ID and META_ACCESS_TOKEN are required", true);
  }

  try {
    let result;

    if (mode === "production" && input.template) {
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
