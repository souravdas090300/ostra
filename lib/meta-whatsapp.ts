/**
 * Meta WhatsApp Business API Client
 * Uses Meta's Graph API for WhatsApp messaging
 */

import crypto from "crypto";

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
    category: string;
    language: string;
  }>;
};

/**
 * Helper to construct Meta Graph API URLs
 */
const graphApiUrl = (path: string) => {
  const version = process.env.META_API_VERSION || "v18.0";
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
  const expectedSignature = crypto
    .createHmac("sha256", appSecret)
    .update(body)
    .digest("hex");
  return signature === expectedSignature;
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
    const error = await response.json();
    throw new WhatsAppError(
      error.error?.message || "Failed to send message",
      response.status >= 400 && response.status < 500 && response.status !== 429,
      response.status
    );
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
    const error = await response.json();
    throw new WhatsAppError(
      error.error?.message || "Failed to send template message",
      response.status >= 400 && response.status < 500 && response.status !== 429,
      response.status
    );
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
    const error = await response.json();
    throw new WhatsAppError(
      error.error?.message || "Failed to create template",
      response.status >= 400 && response.status < 500 && response.status !== 429,
      response.status
    );
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
