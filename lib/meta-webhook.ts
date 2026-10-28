import { prisma } from "./db";
import { processInbound } from "./inbound";
import { log } from "./log";

const RANK: Record<string, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

type MetaPayload = {
  entry?: Array<{
    changes: Array<{
      field: string;
      value: any;
    }>;
  }>;
};

type MetaMessage = {
  id: string;
  from: string;
  type: string;
  text?: { body: string };
  button?: { text: string };
  interactive?: {
    button_reply?: { title: string };
    list_reply?: { title: string };
  };
};

type MetaStatus = {
  id: string;
  status: string;
  errors?: Array<{ code: number }>;
};

type MetaTemplateStatus = {
  message_template_id: string;
  event_type: string;
  status: string;
  rejection_reason?: string;
  category?: string;
};

export async function handleMetaPayload(payload: unknown): Promise<void> {
  const data = payload as MetaPayload;
  if (!data.entry) return;

  await Promise.all(
    data.entry.map(async (entry) =>
      Promise.all(
        entry.changes.map(async (change: { field: string; value: any }) => {
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

async function handleMessages(value: any): Promise<void> {
  const metadata = value.metadata || {};
  const phoneNumberId = metadata.phone_number_id;

  // Find owner by phone number ID
  const owner = await prisma.owner.findUnique({
    where: { whatsappPhoneNumberId: phoneNumberId },
  });
  if (!owner) {
    log("warn", "meta_webhook_unknown_phone", { phoneNumberId });
    return;
  }

  // Process messages
  const messages = value.messages || [];
  await Promise.all(messages.map((message: MetaMessage) => processMetaMessage(message, owner.id, phoneNumberId)));

  // Process statuses
  const statuses = value.statuses || [];
  await Promise.all(statuses.map((status: MetaStatus) => processMetaStatus(status)));
}

async function processMetaMessage(message: MetaMessage, ownerId: string, phoneNumberId: string): Promise<void> {
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

async function processMetaStatus(status: MetaStatus): Promise<void> {
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

async function handleTemplateStatus(value: any): Promise<void> {
  const templateStatus = value as MetaTemplateStatus;
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