import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyMetaWebhookSignature } from "@/lib/meta-whatsapp";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Status priority mapping (higher value = more final)
const STATUS_PRIORITY: Record<string, number> = {
  failed: 5,
  undelivered: 4,
  read: 3,
  delivered: 2,
  sent: 1,
  queued: 0,
};

export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  if (!verifyMetaWebhookSignature(signature, raw)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse(null, { status: 200 });
  }

  try {
    await handleStatusUpdates(payload);
  } catch (e) {
    log("error", "meta_status_webhook_failed", {});
  }

  return new NextResponse(null, { status: 200 });
}

async function handleStatusUpdates(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("entry" in payload)) {
    return;
  }

  const entries = (payload as { entry: unknown[] }).entry;
  if (!Array.isArray(entries)) {
    return;
  }

  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || !("changes" in entry)) {
      continue;
    }

    const changes = (entry as { changes: unknown[] }).changes;
    if (!Array.isArray(changes)) {
      continue;
    }

    for (const change of changes) {
      if (!change || typeof change !== "object" || !("value" in change)) {
        continue;
      }

      const value = (change as { value: unknown }).value;
      if (!value || typeof value !== "object" || !("statuses" in value)) {
        continue;
      }

      const statuses = (value as { statuses: unknown[] }).statuses;
      if (!Array.isArray(statuses)) {
        continue;
      }

      for (const statusUpdate of statuses) {
        if (!statusUpdate || typeof statusUpdate !== "object") {
          continue;
        }

        const id = (statusUpdate as { id?: string }).id;
        const status = (statusUpdate as { status?: string }).status;
        const errors = (statusUpdate as { errors?: Array<{ code?: number }> }).errors;

        if (!id || !status) {
          continue;
        }

        const errorCode = errors?.[0]?.code ?? null;

        // Try to find and update in Message, LeadMessage, or UnmatchedMessage
        await updateMessageStatus(id, status, errorCode);
        await updateLeadMessageStatus(id, status, errorCode);
        await updateUnmatchedMessageStatus(id, status, errorCode);
      }
    }
  }
}

async function updateMessageStatus(metaMessageId: string, status: string, errorCode: number | null) {
  const message = await prisma.message.findUnique({
    where: { metaMessageId },
    select: { id: true, deliveryStatus: true },
  });

  if (!message) {
    return;
  }

  // Don't downgrade status (e.g., don't change "delivered" to "sent")
  const currentPriority = STATUS_PRIORITY[message.deliveryStatus ?? "queued"] ?? 0;
  const newPriority = STATUS_PRIORITY[status] ?? 0;

  if (newPriority <= currentPriority) {
    return;
  }

  await prisma.message.update({
    where: { id: message.id },
    data: {
      deliveryStatus: status,
      errorCode,
    },
  });
}

async function updateLeadMessageStatus(metaMessageId: string, status: string, errorCode: number | null) {
  const message = await prisma.leadMessage.findUnique({
    where: { metaMessageId },
    select: { id: true, deliveryStatus: true },
  });

  if (!message) {
    return;
  }

  const currentPriority = STATUS_PRIORITY[message.deliveryStatus ?? "queued"] ?? 0;
  const newPriority = STATUS_PRIORITY[status] ?? 0;

  if (newPriority <= currentPriority) {
    return;
  }

  await prisma.leadMessage.update({
    where: { id: message.id },
    data: {
      deliveryStatus: status,
      errorCode,
    },
  });
}

async function updateUnmatchedMessageStatus(metaMessageId: string, status: string, errorCode: number | null) {
  const message = await prisma.unmatchedMessage.findUnique({
    where: { metaMessageId },
    select: { id: true },
  });

  if (!message) {
    return;
  }

  // UnmatchedMessage doesn't have deliveryStatus in schema, but we could add it later
  // For now, just log that we received a status update
  log("info", "unmatched_message_status", { metaMessageId, status, errorCode });
}
