import { prisma } from "./db";
import { sendWhatsApp } from "./whatsapp";
import { windowOpen } from "./reply-window";
import { reportError } from "./report-error";
import { log } from "./log";

const UNSUBSCRIBE_PHRASES = [
  "stop",
  "unsubscribe",
  "no more messages",
  "don't contact",
  "remove me",
  "leave me alone",
  "not interested anymore",
] as const;

/**
 * Check if a message contains unsubscribe intent.
 */
export function containsUnsubscribe(body: string): boolean {
  const lower = body.toLowerCase();
  return UNSUBSCRIBE_PHRASES.some((phrase) => lower.includes(phrase));
}

/**
 * Get leads that are eligible for follow-up:
 * - status = QUOTED
 * - followUpSentAt is null (no follow-up sent yet)
 * - last inbound message was more than the configured hours ago
 * - enquiriesEnabled is true for the owner
 */
export async function getLeadsNeedingFollowUp(hours: number = 16): Promise<Array<{ id: string; phone: string; ownerId: string; lastInboundAt: Date }>> {
  const cutoff = new Date(Date.now() - hours * 60 * 60_000);

  const leads = await prisma.lead.findMany({
    where: {
      status: "QUOTED",
      followUpSentAt: null,
      lastInboundAt: { lt: cutoff },
      blockedAt: null,
      owner: { enquiriesEnabled: true },
    },
    select: {
      id: true,
      phone: true,
      ownerId: true,
      lastInboundAt: true,
    },
  });

  return leads;
}

/**
 * Send a follow-up message to a lead.
 * Returns true if sent, false if skipped (e.g., window closed).
 */
export async function sendFollowUpToLead(leadId: string): Promise<{ sent: boolean; reason?: string }> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      owner: { select: { hostLanguage: true, defaultGuestLanguage: true } },
      messages: {
        where: { direction: "INBOUND" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!lead) {
    return { sent: false, reason: "Lead not found" };
  }

  if (lead.followUpSentAt) {
    return { sent: false, reason: "Follow-up already sent" };
  }

  if (lead.status !== "QUOTED") {
    return { sent: false, reason: "Lead not in QUOTED status" };
  }

  // Check if lead has recently said to stop
  const recentMessages = await prisma.leadMessage.findMany({
    where: {
      leadId,
      direction: "INBOUND",
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60_000) }, // last 7 days
    },
    select: { body: true },
  });

  for (const msg of recentMessages) {
    if (containsUnsubscribe(msg.body)) {
      log("info", "lead_follow_up_unsubscribe", { leadId, phone: lead.phone });
      return { sent: false, reason: "Lead requested to stop messages" };
    }
  }

  // Check WhatsApp 24-hour window
  const lastGuestMessage = lead.messages[0];
  const now = new Date();
  const windowIsOpen = windowOpen(lastGuestMessage?.createdAt ?? null, now);

  if (!windowIsOpen) {
    // Window closed: flag for host instead
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        status: "NEEDS_HOST",
        needsHostReason: "Follow-up window closed",
      },
    });
    log("info", "lead_follow_up_window_closed", { leadId, phone: lead.phone });
    return { sent: false, reason: "WhatsApp window closed, flagged for host" };
  }

  // Determine language for follow-up
  const language = lead.language || lead.owner.defaultGuestLanguage || "en";

  // Simple follow-up messages (could be enhanced with templates)
  const followUpMessages: Record<string, string> = {
    en: "Hi! Just checking in - are you still interested in booking these dates?",
    it: "Ciao! Volevo solo verificare - sei ancora interessato a prenotare queste date?",
    de: "Hallo! Ich wollte nur nachfragen - bist du noch an diesen Daten interessiert?",
    fr: "Bonjour! Je voulais juste vérifier - êtes-vous toujours intéressé par ces dates?",
    es: "¡Hola! Solo quería verificar - ¿sigues interesado en reservar estas fechas?",
    mt: "Bongu! Kien nirringrazzja - għadek interessat li tibbukkja dawn id-dati?",
  };

  const message = followUpMessages[language] || followUpMessages.en;

  try {
    const { sid } = await sendWhatsApp({
      to: lead.phone,
      text: message,
      ownerId: lead.ownerId,
      kind: "WA_FREEFORM",
    });

    // Store the follow-up message
    await prisma.leadMessage.create({
      data: {
        leadId,
        direction: "OUTBOUND",
        author: "SYSTEM",
        body: message,
        language,
        twilioSid: sid ?? undefined,
        deliveryStatus: sid ? "sent" : "dry-run",
      },
    });

    // Mark follow-up as sent
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        followUpSentAt: now,
        lastOutboundAt: now,
      },
    });

    log("info", "lead_follow_up_sent", { leadId, phone: lead.phone, sid });
    return { sent: true };
  } catch (e) {
    reportError(e, { leadId, phone: lead.phone });
    return { sent: false, reason: "Failed to send WhatsApp message" };
  }
}

/**
 * Process all leads needing follow-up.
 * Returns count of leads processed and sent.
 */
export async function processLeadFollowUps(hours: number = 16): Promise<{ processed: number; sent: number; skipped: number }> {
  const leads = await getLeadsNeedingFollowUp(hours);

  let sent = 0;
  let skipped = 0;

  for (const lead of leads) {
    const result = await sendFollowUpToLead(lead.id);
    if (result.sent) {
      sent++;
    } else {
      skipped++;
    }
  }

  return { processed: leads.length, sent, skipped };
}
