import { prisma } from "./db";
import { processInbound } from "./inbound";
import { log } from "./log";
import { z } from "zod";

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
  message_template_id: z.string(),
  event_type: z.string(),
  status: z.string(),
  rejection_reason: z.string().optional(),
  category: z.string().optional(),
});

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

          if (field === "messages") {
            await handleMessages(value);
          } else if (field === "message_template_status_update") {
            await handleTemplateStatus(value);
          }
          // Ignore other fields (phone_number_quality_update, account_update, etc.)
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
  await Promise.all(messages.map((message) => processMetaMessage(message, owner.id, phoneNumberId)));

  // Process statuses
  const statuses = parsed.data.statuses || [];
  await Promise.all(statuses.map((status) => processMetaStatus(status)));
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
  const templateStatus = parsed.data;
  const { message_template_id, event_type, rejection_reason, category } = templateStatus;

  if (!message_template_id) return;

  // Find template by metaTemplateId, then by metaTemplateName
  let translation = await prisma.templateTranslation.findFirst({
    where: { metaTemplateId: message_template_id },
  });

  translation ??= await prisma.templateTranslation.findFirst({
    where: { metaTemplateName: message_template_id },
  });

  if (!translation) return;

  let newApproval = translation.approval;
  let newRejectionReason = translation.rejectionReason;
  let newCategory = translation.metaCategory;

  // Handle template status events
  if (event_type === "APPROVED") {
    newApproval = "APPROVED";
    newRejectionReason = null;
  } else if (event_type === "REJECTED") {
    newApproval = "REJECTED";
    newRejectionReason = rejection_reason || "Rejected by Meta";
  } else if (event_type === "PAUSED" || event_type === "DISABLED") {
    newApproval = "NONE"; // Not usable
  }

  // Update category if provided
  if (category) {
    newCategory = category;
  }

  // Update if anything changed
  if (
    newApproval !== translation.approval ||
    newRejectionReason !== translation.rejectionReason ||
    newCategory !== translation.metaCategory
  ) {
    await prisma.templateTranslation.update({
      where: { id: translation.id },
      data: {
        approval: newApproval,
        rejectionReason: newRejectionReason,
        metaCategory: newCategory,
      },
    });
  }
}