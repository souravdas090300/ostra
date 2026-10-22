import twilio from "twilio";
import { recordUsage } from "./usage";
import type { UsageKind } from "@prisma/client";

export type WhatsAppMode = "dry-run" | "sandbox" | "production";

export const whatsappMode = (): WhatsAppMode => {
  const m = process.env.WHATSAPP_MODE;
  return m === "sandbox" || m === "production" ? m : "dry-run"; // anything else is dry-run
};

export class WhatsAppError extends Error {
  constructor(message: string, public permanent: boolean, public code?: number) {
    super(message);
  }
}

let client: ReturnType<typeof twilio> | null = null;

const getClient = () =>
  (client ??= twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!));

export type SendInput = {
  to: string; // E.164
  text: string; // rendered text (used for free-form and for our own record)
  template?: { contentSid: string; variables: Record<string, string> }; // numbered: {"1": "...", "2": "..."}
  ownerId?: string;
  kind?: UsageKind;
};

/** Returns the Twilio message SID, or null in dry-run. Throws WhatsAppError. */
export async function sendWhatsApp(input: SendInput): Promise<{ sid: string | null }> {
  const mode = whatsappMode();
  if (mode === "dry-run") {
    // Record usage even in dry-run mode for accurate tracking
    if (input.ownerId && input.kind) {
      await recordUsage(input.ownerId, input.kind);
    }
    return { sid: null };
  }

  try {
    const base = {
      from: process.env.TWILIO_WHATSAPP_FROM!,
      to: `whatsapp:${input.to}`,
      statusCallback: `${process.env.APP_URL}/api/webhooks/twilio-status`,
    };
    const msg =
      mode === "production" && input.template
        ? await getClient().messages.create({
            ...base,
            contentSid: input.template.contentSid,
            contentVariables: JSON.stringify(input.template.variables),
          })
        : await getClient().messages.create({ ...base, body: input.text });
    // Record usage after successful send
    if (input.ownerId && input.kind) {
      await recordUsage(input.ownerId, input.kind);
    }
    return { sid: msg.sid };
  } catch (e: unknown) {
    const status: number | undefined = e instanceof Object && "status" in e ? (e as { status?: number }).status : undefined;
    const permanent = typeof status === "number" && status >= 400 && status < 500 && status !== 429;
    const code: number | undefined = e instanceof Object && "code" in e ? (e as { code?: number }).code : undefined;
    throw new WhatsAppError(
      "WhatsApp send failed",
      permanent,
      code,
    );
  }
}
