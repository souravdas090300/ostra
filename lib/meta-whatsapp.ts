/**
 * Meta WhatsApp Business API Client
 * Uses Meta's Graph API for WhatsApp messaging
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type WhatsAppMode = "dry-run" | "sandbox" | "production";

export const whatsappMode = (): WhatsAppMode => {
  const m = process.env.WHATSAPP_MODE;
  return m === "sandbox" || m === "production" ? m : "dry-run";
};

export class WhatsAppError extends Error {
  constructor(message: string, public permanent: boolean, public code?: number) {
    super(message);
  }
}

async function graphError(response: Response, fallback: string): Promise<WhatsAppError> {
  const body = await response.json().catch(() => undefined) as
    | { error?: { code?: unknown } }
    | undefined;
  const code = body?.error?.code;
  return new WhatsAppError(
    fallback,
    response.status >= 400 && response.status < 500 && response.status !== 429,
    typeof code === "number" ? code : undefined,
  );
}

/**
 * Meta Graph API types
 */
export type MetaMessageId = string;

export type MetaTemplate = {
  name: string;
  language: { code: string };
  components: Array<{
    type: "BODY" | "HEADER" | "FOOTER";
    text: string;
    example?: { body_text?: string[] | string[][] };
  }>;
};

export type MetaSendMessageResponse = {
  messaging_product: "whatsapp";
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
};

export type MetaTemplateResponse = {
  data: Array<{
    id: string;
    name: string;
    status: string;
    language: string;
    category?: string;
  }>;
  paging?: {
    next?: string;
    cursors?: { before?: string; after?: string };
  };
};

/**
 * Helper to construct Meta Graph API URLs
 */
const graphApiUrl = (path: string) => {
  const version = process.env.META_API_VERSION;
  if (!version || !/^v\d+\.\d+$/.test(version)) {
    throw new WhatsAppError("A valid META_API_VERSION is required.", true);
  }
  return `https://graph.facebook.com/${version}/${path}`;
};

/**
 * Verify Meta webhook signature
 */
export function verifyMetaWebhookSignature(
  body: string,
  signature: string,
  appSecret: string
): boolean {
  const signatureHex = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  if (!/^[a-f0-9]{64}$/i.test(signatureHex)) return false;
  const expected = createHmac("sha256", appSecret).update(body, "utf8").digest();
  const received = Buffer.from(signatureHex, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/**
 * Send a text message via Meta WhatsApp Business API
 */
export async function sendMetaTextMessage(params: {
  to: string; // Phone number with country code, no +
  from: string; // WhatsApp Business phone number ID
  text: string;
  accessToken: string;
}): Promise<{ messageId: string }> {
  const url = graphApiUrl(`${params.from}/messages`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: params.to,
      text: { body: params.text },
    }),
  });

  if (!response.ok) {
    throw await graphError(response, "WhatsApp rejected the message.");
  }

  const data: MetaSendMessageResponse = await response.json();
  const messageId = data.messages[0]?.id;

  if (!messageId) {
    throw new WhatsAppError("No message ID in response", true);
  }

  return { messageId };
}

/**
 * Send a template message via Meta WhatsApp Business API
 */
export async function sendMetaTemplateMessage(params: {
  to: string;
  from: string;
  templateName: string;
  languageCode: string;
  components?: Array<{ type: string; parameters: Array<{ type: string; text: string }> }>;
  accessToken: string;
}): Promise<{ messageId: string }> {
  const url = graphApiUrl(`${params.from}/messages`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: params.to,
      template: {
        name: params.templateName,
        language: { code: params.languageCode },
        ...(params.components?.length ? { components: params.components } : {}),
      },
    }),
  });

  if (!response.ok) {
    throw await graphError(response, "WhatsApp rejected the template message.");
  }

  const data: MetaSendMessageResponse = await response.json();
  const messageId = data.messages[0]?.id;

  if (!messageId) {
    throw new WhatsAppError("No message ID in response", true);
  }

  return { messageId };
}

/**
 * Get message status from Meta
 */
export async function getMetaMessageStatus(params: {
  messageId: string;
  accessToken: string;
}): Promise<{ status: string; errorCode?: number }> {
  const url = graphApiUrl(params.messageId);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${params.accessToken}`,
    },
  });

  if (!response.ok) {
    throw new WhatsAppError("Failed to get message status", false);
  }

  const data = await response.json();

  // Meta status mapping
  const status = data.error?.message
    ? "failed"
    : data.fields?.messaging_product === "whatsapp"
    ? data.status || "sent"
    : "unknown";

  return {
    status,
    errorCode: data.error?.code,
  };
}

/**
 * Create a template in Meta
 */
export async function createMetaTemplate(params: {
  from: string;
  template: MetaTemplate;
  accessToken: string;
}): Promise<{ id: string }> {
  const url = graphApiUrl(`${params.from}/message_templates`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params.template),
  });

  if (!response.ok) {
    throw await graphError(response, "Meta rejected the template.");
  }

  const data = await response.json();
  return { id: data.id };
}

/**
 * Get templates from Meta
 */
export async function getMetaTemplates(params: {
  from: string;
  accessToken: string;
}): Promise<MetaTemplateResponse> {
  const url = graphApiUrl(`${params.from}/message_templates`);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${params.accessToken}`,
    },
  });

  if (!response.ok) {
    throw new WhatsAppError("Failed to get templates", false);
  }

  return response.json();
}

/**
 * Delete a template from Meta
 */
export async function deleteMetaTemplate(params: {
  from: string;
  templateName: string;
  accessToken: string;
}): Promise<void> {
  const url = graphApiUrl(`${params.from}/message_templates`);

  const response = await fetch(`${url}?name=${encodeURIComponent(params.templateName)}`, {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${params.accessToken}`,
    },
  });

  if (!response.ok) {
    throw new WhatsAppError("Failed to delete template", false);
  }
}
