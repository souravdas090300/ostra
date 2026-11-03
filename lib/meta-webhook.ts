import { prisma } from "./db";
import { processInbound } from "./inbound";
import { log } from "./log";
import { z } from "zod";
import { ostraTemplateLanguage } from "./templates";

const RANK: Record<string, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

const metaMessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  button: z.object({ text: z.string() }).optional(),
  interactive: z.object({
    button_reply: z.object({ title: z.string() }).optional(),
    list_reply: z.object({ title: z.string() }).optional(),
  }).optional(),
});
const metaStatusSchema = z.object({
  id: z.string(),
  status: z.string(),
  errors: z.array(z.object({ code: z.number() })).optional(),
});
const metaPayloadSchema = z.object({
  entry: z.array(z.object({
    changes: z.array(z.object({ field: z.string(), value: z.unknown() })),
  })).optional(),
});
const messagesValueSchema = z.object({
  metadata: z.object({ phone_number_id: z.string() }).optional(),
  messages: z.array(metaMessageSchema).optional(),
  statuses: z.array(metaStatusSchema).optional(),
});
const templateStatusSchema = z.object({
  message_template_id: z.string().optional(),
  message_template_name: z.string().optional(),
  message_template_language: z.string().optional(),
  event_type: z.string().optional(),
  status: z.string().optional(),
  rejection_reason: z.string().optional(),
  reason: z.string().optional(),
  category: z.string().optional(),
  new_category: z.string().optional(),
}).passthrough();

export async function handleMetaPayload(payload: unknown): Promise<void> {
  const parsed = metaPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    log("warn", "meta_webhook_invalid_payload", {});
    return;
  }
  const data = parsed.data;
  if (!data.entry) return;

  await Promise.all(
    data.entry.map(async (entry) =>
      Promise.all(
        entry.changes.map(async (change) => {
          const field = change.field;
          const value = change.value;

          try {
            if (field === "messages") {
              await handleMessages(value);
            } else if (field === "message_template_status_update") {
              await handleTemplateStatus(value);
            }
          } catch {
            log("error", "meta_webhook_change_failed", { status: "change_failed" });
          }
        })
      )
    )
  );
}

async function handleMessages(value: unknown): Promise<void> {
  const parsed = messagesValueSchema.safeParse(value);
  if (!parsed.success) {
    log("warn", "meta_webhook_invalid_messages", {});
    return;
  }
  const phoneNumberId = parsed.data.metadata?.phone_number_id;
  if (!phoneNumberId) {
    log("warn", "meta_webhook_missing_phone_id", {});
    return;
  }

  // Find owner by phone number ID
  const owner = await prisma.owner.findUnique({
    where: { whatsappPhoneNumberId: phoneNumberId },
  });
  if (!owner) {
    log("warn", "meta_webhook_unknown_phone", { phoneNumberId });
    return;
  }

  // Process messages
  const messages = parsed.data.messages || [];
  await Promise.all(
    messages.map(async (message) => {
      try {
        await processMetaMessage(message, owner.id, phoneNumberId);
      } catch {
        log("error", "meta_webhook_message_failed", { status: "message_failed" });
      }
    }),
  );

  // Process statuses
  const statuses = parsed.data.statuses || [];
  await Promise.all(
    statuses.map(async (status) => {
      try {
        await processMetaStatus(status);
      } catch {
        log("error", "meta_webhook_status_failed", { status: "status_failed" });
      }
    }),
  );
}

async function processMetaMessage(message: z.infer<typeof metaMessageSchema>, ownerId: string, phoneNumberId: string): Promise<void> {
  const sid = message.id;
  const from = "+" + message.from; // Meta sends digits without the plus sign
  const to = phoneNumberId;

  // Extract body based on message type
  let body = "";
  let hasMedia = false;

  switch (message.type) {
    case "text":
      body = message.text?.body || "";
      break;
    case "button":
      body = message.button?.text || "";
      break;
    case "interactive":
      body = message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || "";
      break;
    case "image":
    case "audio":
    case "video":
    case "document":
    case "sticker":
    case "location":
    case "contacts":
      hasMedia = true;
      break;
    case "reaction":
    case "unsupported":
    default:
      // Ignore these message types
      return;
  }

  // Process the inbound message
  await processInbound({
    sid,
    from,
    to,
    body,
    numMedia: hasMedia ? 1 : 0,
  });
}

async function processMetaStatus(status: z.infer<typeof metaStatusSchema>): Promise<void> {
  const sid = status.id;
  const statusValue = status.status; // sent, delivered, read, failed
  const errorCode = status.errors?.[0]?.code;

  if (!sid || !statusValue) return;

  // Only update if the new status has a higher or equal rank (prevents downgrades)
  const rank = RANK[statusValue] ?? 0;

  // Update Message
  const msg = await prisma.message.findUnique({ where: { metaMessageId: sid } });
  if (msg && rank >= (RANK[msg.deliveryStatus ?? ""] ?? 0)) {
    await prisma.message.update({
      where: { id: msg.id },
      data: {
        deliveryStatus: statusValue,
        errorCode: errorCode ? Number(errorCode) : null,
      },
    });
  }

  // Update LeadMessage
  const leadMsg = await prisma.leadMessage.findUnique({ where: { metaMessageId: sid } });
  if (leadMsg && rank >= (RANK[leadMsg.deliveryStatus ?? ""] ?? 0)) {
    await prisma.leadMessage.update({
      where: { id: leadMsg.id },
      data: {
        deliveryStatus: statusValue,
        errorCode: errorCode ? Number(errorCode) : null,
      },
    });
  }

  // Update UnmatchedMessage (mark handled if failed)
  const unmatchedMsg = await prisma.unmatchedMessage.findUnique({ where: { metaMessageId: sid } });
  if (unmatchedMsg && statusValue === "failed") {
    await prisma.unmatchedMessage.update({
      where: { id: unmatchedMsg.id },
      data: { handledAt: new Date() },
    });
  }
}

async function handleTemplateStatus(value: unknown): Promise<void> {
  const parsed = templateStatusSchema.safeParse(value);
  if (!parsed.success) {
    log("warn", "meta_webhook_invalid_template_status", {});
    return;
  }
  const {
    message_template_id: id,
    message_template_name: name,
    message_template_language: locale,
    event_type: eventType,
    status,
    rejection_reason: rejectionReason,
    reason,
    category,
    new_category: newCategory,
  } = parsed.data;
  const nextStatus = (status ?? eventType ?? "").toUpperCase();
  if (!id && !name) return;

  let translation = id
    ? await prisma.templateTranslation.findFirst({ where: { metaTemplateId: id } })
    : null;
  if (!translation && name) {
    const language = locale ? ostraTemplateLanguage(locale) : undefined;
    translation = await prisma.templateTranslation.findFirst({
      where: {
        metaTemplateName: name,
        ...(language ? { language } : {}),
      },
    });
  }

  if (!translation) return;

  let newApproval = translation.approval;
  let newRejectionReason = translation.rejectionReason;
  const reportedCategory = newCategory ?? category;
  const assignedCategory =
    reportedCategory && ["UTILITY", "MARKETING", "AUTHENTICATION"].includes(reportedCategory.toUpperCase())
      ? reportedCategory.toUpperCase()
      : translation.metaCategory;

  // Handle template status events
  if (nextStatus === "APPROVED") {
    newApproval = "APPROVED";
    newRejectionReason = null;
  } else if (nextStatus === "REJECTED") {
    newApproval = "REJECTED";
    newRejectionReason = rejectionReason ?? reason ?? "Rejected by Meta";
  } else if (nextStatus === "PAUSED" || nextStatus === "DISABLED") {
    newApproval = "NONE"; // Not usable
    newRejectionReason = `Template is ${nextStatus.toLowerCase()} by Meta.`;
  } else if (nextStatus === "PENDING" || nextStatus === "IN_APPEAL") {
    newApproval = "PENDING";
  }

  // Update if anything changed
  if (
    newApproval !== translation.approval ||
    newRejectionReason !== translation.rejectionReason ||
    assignedCategory !== translation.metaCategory
  ) {
    await prisma.templateTranslation.update({
      where: { id: translation.id },
      data: {
        approval: newApproval,
        rejectionReason: newRejectionReason,
        metaCategory: assignedCategory,
      },
    });
  }
}