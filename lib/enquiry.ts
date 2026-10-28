import { prisma } from "./db";
import { answerEnquiry, buildEnquiryHistory, holdingText, fallbackOutput, type EnquiryOutput } from "./enquiry-assistant";
import { isStopKeyword } from "./guards";
import { normaliseLanguage } from "./languages";
import { notifyHost } from "./notify";
import { optOutPhone } from "./optout";
import { todayMalta } from "./dates";
import { WhatsAppError, sendWhatsApp } from "./whatsapp";
import { log } from "./log";
import { assistantEnabled } from "./flags";
import { assertAiBudget, recordUsage, checkAndSendBudgetWarning, BudgetExceededError } from "./usage";
import type { TurnContext } from "./enquiry-tools";
import { HOUR, E164, STOP_CONFIRM, type InboundInput } from "./shared-constants";

export async function handleEnquiry(i: InboundInput, now = new Date()): Promise<void> {
  const from = i.from.replace(/^whatsapp:/, "");
  const to = i.to.replace(/^whatsapp:/, "");
  if (!E164.test(from)) return;
  const owner = await prisma.owner.findUnique({ where: { whatsappPhoneNumberId: to } });
  if (!owner) return;

  // Idempotent: check LeadMessage and legacy UnmatchedMessage
  if (
    await prisma.leadMessage.findUnique({ where: { metaMessageId: i.sid } })
  )
    return;
  if (
    await prisma.unmatchedMessage.findUnique({ where: { metaMessageId: i.sid } })
  )
    return;

  const body = i.body.trim().slice(0, 2000);
  const hasMedia = i.numMedia > 0;
  if (!body && !hasMedia) return;

  // Upsert lead
  const lead = await prisma.lead.upsert({
    where: { ownerId_phone: { ownerId: owner.id, phone: from } },
    update: {
      lastInboundAt: now,
      status: "NEW", // LOST becomes NEW on new message
    },
    create: {
      ownerId: owner.id,
      phone: from,
      status: "NEW",
      lastInboundAt: now,
    },
  });

  // Blocked number: return silently
  if (lead.blockedAt) return;

  // Store inbound message
  const inbound = await prisma.leadMessage.create({
    data: {
      leadId: lead.id,
      direction: "INBOUND",
      author: "GUEST",
      body,
      hasMedia,
      metaMessageId: i.sid,
    },
  });

  // Limits (no reply, no AI)
  const lastHour = await prisma.leadMessage.count({
    where: {
      leadId: lead.id,
      direction: "INBOUND",
      createdAt: { gte: new Date(now.getTime() - HOUR) },
    },
  });
  if (lastHour > 20) {
    log("warn", "enquiry.rate_limited", { leadId: lead.id });
    return;
  }

  const dayAgo = new Date(now.getTime() - 24 * HOUR);
  const [aiLead, aiOwner] = await Promise.all([
    prisma.leadMessage.count({
      where: { leadId: lead.id, author: "AI", createdAt: { gte: dayAgo } },
    }),
    prisma.leadMessage.count({
      where: {
        author: "AI",
        createdAt: { gte: dayAgo },
        lead: { ownerId: owner.id },
      },
    }),
  ]);
  const maxEnquiryAi = Number(process.env.MAX_ENQUIRY_AI_PER_DAY ?? 100);
  if (aiLead >= 12 || aiOwner >= maxEnquiryAi) {
    await escalate(owner, lead, inbound.id, {
      reason: "Assistant limit reached, no reply was sent.",
      urgent: false,
      hostSummary: "A guest wrote to you but the assistant's daily limit was reached. Please reply yourself.",
      sendFailed: false,
    });
    return;
  }

  // Exact STOP: no AI
  if (isStopKeyword(inbound.body)) {
    await optOutPhone(owner.id, from);
    const lang = normaliseLanguage(lead.language) ?? "en";
    await reply(lead.id, from, STOP_CONFIRM[lang] ?? STOP_CONFIRM.en, "SYSTEM", lang, owner.id);
    log("info", "enquiry.stop", { leadId: lead.id });
    return;
  }

  // Media only: hand over to host
  if (!inbound.body) {
    const lang = normaliseLanguage(lead.language) ?? "en";
    const ok = await reply(lead.id, from, holdingText(lang), "AI", lang, owner.id);
    await escalate(owner, lead, inbound.id, {
      reason: "Guest sent a photo or voice message.",
      urgent: false,
      hostSummary: "The guest sent a photo or voice message. Open the chat on your phone to view it.",
      sendFailed: !ok,
    });
    return;
  }

  // Kill switch: assistant disabled
  if (!assistantEnabled()) {
    const lang = normaliseLanguage(lead.language) ?? "en";
    const ok = await reply(lead.id, from, holdingText(lang), "AI", lang, owner.id);
    await escalate(owner, lead, inbound.id, {
      reason: "Assistant switched off.",
      urgent: false,
      hostSummary: "A guest wrote to you but the assistant is switched off. Please reply yourself.",
      sendFailed: !ok,
    });
    return;
  }

  // Budget check
  try {
    await assertAiBudget(owner.id, now);
  } catch (e) {
    if (e instanceof BudgetExceededError) {
      await escalate(owner, lead, inbound.id, {
        reason: "Monthly AI budget reached, no reply was sent.",
        urgent: false,
        hostSummary: "A guest wrote to you but the monthly AI budget was reached. Please reply yourself.",
        sendFailed: false,
      });
      return;
    }
    throw e;
  }

  // Build history and run assistant
  const previous = await prisma.leadMessage.findMany({
    where: { leadId: lead.id, id: { not: inbound.id }, createdAt: { lte: inbound.createdAt } },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { direction: true, body: true },
  }) as Array<{ direction: "INBOUND" | "OUTBOUND"; body: string }>;

  const apartments = await prisma.apartment.findMany({
    where: { ownerId: owner.id },
    select: { name: true, publicInfo: true },
  });
  const allowedText = apartments.map((a) => `${a.publicInfo} ${a.name}`).join("\n");

  const ctx: TurnContext = {
    ownerId: owner.id,
    leadId: lead.id,
    now,
    results: new Map(),
    saved: {},
    allowedAmounts: new Set(),
    allowedText,
  };

  let out: EnquiryOutput;
  try {
    out = await answerEnquiry({
      hostLanguage: owner.hostLanguage,
      today: todayMalta(now),
      knownLanguage: lead.language,
      apartmentNames: apartments.map((a) => a.name),
      history: buildEnquiryHistory(previous.reverse(), inbound.body),
      allowedText,
      ctx,
    });
    await recordUsage(owner.id, "AI_REPLY", out.usage);
    await checkAndSendBudgetWarning(owner.id, now);
  } catch {
    out = fallbackOutput(
      lead.language,
      "The assistant was unavailable.",
      "A guest wrote to you and the assistant could not answer. Please reply yourself.",
    );
  }

  // Act on result
  if (out.optOut) await optOutPhone(owner.id, from);
  const sent = await reply(lead.id, from, out.reply, "AI", out.language ?? lead.language, owner.id);

  // Update lead details
  if (ctx.saved.name) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { name: ctx.saved.name },
    });
  }
  if (ctx.saved.checkInYmd && ctx.saved.checkOutYmd && ctx.saved.guests) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        checkIn: new Date(ctx.saved.checkInYmd),
        checkOut: new Date(ctx.saved.checkOutYmd),
        guests: ctx.saved.guests,
      },
    });
  }
  if (ctx.saved.apartmentId) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { apartmentId: ctx.saved.apartmentId },
    });
  }
  if (out.language && inbound.body.length >= 15) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { language: out.language },
    });
  }

  // Determine status
  if (out.escalate || !sent) {
    await escalate(owner, lead, inbound.id, {
      reason: sent ? out.reason : "The reply could not be sent.",
      urgent: out.urgent,
      hostSummary: out.hostSummary || "A guest message needs your attention.",
      sendFailed: !sent,
    });
  } else {
    // Check if we have a valid quote
    const hasDetails =
      lead.apartmentId &&
      lead.checkIn &&
      lead.checkOut &&
      lead.guests;
    const matchingResult = Array.from(ctx.results.values()).find(
      (r) =>
        r.apartmentId === lead.apartmentId &&
        r.inYmd === lead.checkIn?.toISOString().slice(0, 10) &&
        r.outYmd === lead.checkOut?.toISOString().slice(0, 10) &&
        r.guests === lead.guests &&
        r.available,
    );
    if (hasDetails && matchingResult && matchingResult.totalCents) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          status: "QUOTED",
          quotedCents: matchingResult.totalCents,
        },
      });
    }
  }

  log("info", "enquiry.done", { leadId: lead.id, messageId: inbound.id });
}

async function reply(
  leadId: string,
  to: string,
  text: string,
  author: "AI" | "HOST" | "SYSTEM",
  language: string | null,
  ownerId: string,
): Promise<boolean> {
  try {
    const { sid } = await sendWhatsApp({ to, text, ownerId, kind: "WA_FREEFORM" });
    await prisma.leadMessage.create({
      data: {
        leadId,
        direction: "OUTBOUND",
        author,
        body: text,
        language,
        metaMessageId: sid,
        deliveryStatus: sid ? "queued" : "dry-run",
      },
    });
    return true;
  } catch (e) {
    await prisma.leadMessage.create({
      data: {
        leadId,
        direction: "OUTBOUND",
        author,
        body: text,
        language,
        deliveryStatus: "failed",
        errorCode: e instanceof WhatsAppError ? e.code ?? null : null,
      },
    });
    return false;
  }
}

async function escalate(
  owner: { id: string; email: string },
  lead: { id: string; name: string | null; phone: string },
  inboundId: string,
  e: { reason: string; urgent: boolean; hostSummary: string; sendFailed: boolean },
) {
  await prisma.leadMessage.update({
    where: { id: inboundId },
    data: {
      escalated: true,
      urgent: e.urgent,
      escalationReason: e.reason.slice(0, 300),
      hostSummary: e.hostSummary.slice(0, 600),
    },
  });
  const recent = await prisma.leadMessage.count({
    where: {
      leadId: lead.id,
      escalated: true,
      resolved: false,
      id: { not: inboundId },
      createdAt: { gte: new Date(Date.now() - 30 * 60_000) },
    },
  });
  if (e.urgent || recent === 0) {
    await notifyHost({
      to: owner.email,
      subject: `${e.urgent ? "URGENT: " : ""}A guest needs you`,
      text: `${e.hostSummary}\n\nOpen: ${process.env.APP_URL}/leads/${lead.id}`,
    });
  }
}
