import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { answerGuest, buildHistory, fallbackOutput, holdingText, type AssistantOutput } from "./assistant";
import { detailsUnlocked, matchBooking } from "./inbound-match";
import { isStopKeyword } from "./guards";
import { normaliseLanguage } from "./languages";
import { notifyHost } from "./notify";
import { optOutPhone } from "./optout";
import { todayMalta } from "./dates";
import { WhatsAppError, sendWhatsApp } from "./whatsapp";
import { log } from "./log";
import { assistantEnabled } from "./flags";
import { assertAiBudget, recordUsage, checkAndSendBudgetWarning, BudgetExceededError } from "./usage";

export type InboundInput = { sid: string; from: string; to: string; body: string; numMedia: number };

export type AnswerInboundInput = {
  owner: { id: string; email: string; hostLanguage: string; defaultGuestLanguage: string };
  booking: { id: string; guestPhone: string | null; guestLanguage: string | null; guestName: string | null; checkIn: Date; checkOut: Date; guests: number | null };
  apartment: { name: string; address: string; checkInTime: string; checkOutTime: string; info: string; publicInfo: string; reviewUrl?: string | null };
  inbound: { id: string; body: string; hasMedia: boolean; createdAt: Date };
  from: string;
  now: Date;
};

const HOUR = 3_600_000;
const E164 = /^\+\d{8,15}$/;
const STOP_CONFIRM: Record<string, string> = {
  en: "You will no longer receive messages from us.",
  it: "Non riceverai più messaggi da noi.",
  de: "Sie erhalten keine Nachrichten mehr von uns.",
  fr: "Vous ne recevrez plus de messages de notre part.",
  es: "Ya no recibirá mensajes nuestros.",
};
const UNMATCHED_REPLY =
  "Thanks for your message. We could not find a booking linked to this number. If you have booked with us, please tell us the name on the booking and your host will get back to you.";

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function processInbound(i: InboundInput, now = new Date()): Promise<void> {
  const from = i.from.replace(/^whatsapp:/, "");
  const to = i.to.replace(/^whatsapp:/, "");
  if (!E164.test(from)) return;
  const owner = await prisma.owner.findUnique({ where: { whatsappFrom: to } });
  if (!owner) return;

  // Idempotent: Twilio can deliver the same message more than once.
  if (await prisma.message.findUnique({ where: { twilioSid: i.sid } })) return;
  if (await prisma.unmatchedMessage.findUnique({ where: { twilioSid: i.sid } })) return;

  const body = i.body.trim().slice(0, 2000);
  const hasMedia = i.numMedia > 0;
  if (!body && !hasMedia) return;

  const match = await matchBooking(owner.id, from, now);
  if (!match) return handleUnmatched(owner.id, from, i.sid, body, hasMedia, now);
  const { booking } = match;
  const apartment = booking.apartment;

  let inbound;
  try {
    inbound = await prisma.message.create({
      data: {
        bookingId: booking.id,
        direction: "INBOUND",
        author: "GUEST",
        body,
        hasMedia,
        twilioSid: i.sid,
      },
    });
  } catch (e) {
    if (isUnique(e)) return;
    throw e;
  }

  await answerInbound({ owner, booking, apartment, inbound: { ...inbound, createdAt: inbound.createdAt || now }, from, now });
}

export async function answerInbound(input: AnswerInboundInput): Promise<void> {
  const { owner, booking, apartment, inbound, from, now } = input;

  // Limits: stored, but no reply and no AI call.
  const lastHour = await prisma.message.count({
    where: {
      bookingId: booking.id,
      direction: "INBOUND",
      createdAt: { gte: new Date(now.getTime() - HOUR) },
    },
  });
  if (lastHour > 20) {
    log("warn", "inbound.rate_limited", { bookingId: booking.id });
    return;
  }

  const lang = normaliseLanguage(booking.guestLanguage) ?? normaliseLanguage(owner.defaultGuestLanguage);

  // 1. Exact STOP: no AI.
  if (isStopKeyword(inbound.body)) {
    await optOutPhone(owner.id, from);
    await reply(booking.id, from, STOP_CONFIRM[lang ?? "en"] ?? STOP_CONFIRM.en, "SYSTEM", lang, owner.id);
    log("info", "inbound.stop", { bookingId: booking.id });
    return;
  }

  // 2. Photos and voice notes are not processed: hand over to the host.
  if (!inbound.body) {
    const ok = await reply(booking.id, from, holdingText(lang), "AI", lang, owner.id);
    await escalate(owner, { id: booking.id, guestName: booking.guestName, checkIn: booking.checkIn, checkOut: booking.checkOut, guests: booking.guests }, apartment.name, inbound.id, {
      reason: "Guest sent a photo or voice message.",
      urgent: false,
      hostSummary: "The guest sent a photo or voice message. Open the chat on your phone to view it.",
      sendFailed: !ok,
    });
    return;
  }

  // 3. Debounce: if another message arrived meanwhile, the newer handler answers both.
  await sleep(Number(process.env.INBOUND_DEBOUNCE_MS ?? 3000));
  const latest = await prisma.message.findFirst({
    where: { bookingId: booking.id, direction: "INBOUND" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  if (latest?.id !== inbound.id) return;

  // 4. AI caps.
  const dayAgo = new Date(now.getTime() - 24 * HOUR);
  const [aiBooking, aiOwner] = await Promise.all([
    prisma.message.count({
      where: { bookingId: booking.id, author: "AI", createdAt: { gte: dayAgo } },
    }),
    prisma.message.count({
      where: {
        author: "AI",
        createdAt: { gte: dayAgo },
        booking: { apartment: { ownerId: owner.id } },
      },
    }),
  ]);
  if (aiBooking >= 40 || aiOwner >= Number(process.env.MAX_AI_REPLIES_PER_DAY ?? 300)) {
    await escalate(owner, { id: booking.id, guestName: booking.guestName, checkIn: booking.checkIn, checkOut: booking.checkOut, guests: booking.guests }, apartment.name, inbound.id, {
      reason: "Assistant limit reached, no reply was sent.",
      urgent: false,
      hostSummary: "A guest wrote to you but the assistant's daily limit was reached. Please reply yourself.",
      sendFailed: false,
    });
    return;
  }

  // 5. Kill switch: if assistant is disabled, send holding message and escalate.
  if (!assistantEnabled()) {
    const ok = await reply(booking.id, from, holdingText(lang), "AI", lang, owner.id);
    await escalate(owner, { id: booking.id, guestName: booking.guestName, checkIn: booking.checkIn, checkOut: booking.checkOut, guests: booking.guests }, apartment.name, inbound.id, {
      reason: "Assistant switched off.",
      urgent: false,
      hostSummary: "A guest wrote to you but the assistant is switched off. Please reply yourself.",
      sendFailed: !ok,
    });
    return;
  }

  // 6. Budget check before AI call.
  try {
    await assertAiBudget(owner.id, now);
  } catch (e) {
    if (e instanceof BudgetExceededError) {
      await escalate(owner, { id: booking.id, guestName: booking.guestName, checkIn: booking.checkIn, checkOut: booking.checkOut, guests: booking.guests }, apartment.name, inbound.id, {
        reason: "Monthly AI budget reached, no reply was sent.",
        urgent: false,
        hostSummary: "A guest wrote to you but the monthly AI budget was reached. Please reply yourself.",
        sendFailed: false,
      });
      return;
    }
    throw e;
  }

  // 7. Ask the assistant.
  const previous = await prisma.message.findMany({
    where: { bookingId: booking.id, id: { not: inbound.id }, createdAt: { lte: inbound.createdAt } },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { direction: true, body: true },
  }) as Array<{ direction: "INBOUND" | "OUTBOUND"; body: string }>;
  let out: AssistantOutput;
  try {
    out = await answerGuest({
      hostLanguage: owner.hostLanguage,
      apartment,
      booking,
      unlocked: detailsUnlocked(booking, now),
      today: todayMalta(now),
      knownLanguage: lang,
      history: buildHistory(previous.reverse(), inbound.body),
      allowedText: [apartment.info, apartment.publicInfo, apartment.address, apartment.reviewUrl ?? ""].join("\n"),
    });
    // Record usage after successful AI call
    await recordUsage(owner.id, "AI_REPLY", out.usage);
    // Check if we should send a budget warning
    await checkAndSendBudgetWarning(owner.id, now);
  } catch {
    out = fallbackOutput(
      lang,
      "The assistant was unavailable.",
      "A guest wrote to you and the assistant could not answer. Please reply yourself."
    );
  }

  // 6. Act.
  if (out.optOut) await optOutPhone(owner.id, from);
  const sent = await reply(booking.id, from, out.reply, "AI", out.language ?? lang, owner.id);
  await updateLanguage(booking.id, booking.guestLanguage, inbound.body, out.language);
  if (out.escalate || !sent) {
    await escalate(owner, { id: booking.id, guestName: booking.guestName, checkIn: booking.checkIn, checkOut: booking.checkOut, guests: booking.guests }, apartment.name, inbound.id, {
      reason: sent ? out.reason : "The reply could not be sent.",
      urgent: out.urgent,
      hostSummary: out.hostSummary || "A guest message needs your attention.",
      sendFailed: !sent,
    });
  } else {
    await prisma.message.update({ where: { id: inbound.id }, data: { language: out.language } });
  }
  log("info", "inbound.done", { bookingId: booking.id, messageId: inbound.id });
}

/** Sends a free-form reply (the guest just wrote, so the 24-hour window is open) and records it. */
async function reply(
  bookingId: string,
  to: string,
  text: string,
  author: "AI" | "HOST" | "SYSTEM",
  language: string | null,
  ownerId: string
): Promise<boolean> {
  try {
    const { sid } = await sendWhatsApp({ to, text, ownerId, kind: "WA_FREEFORM" });
    await prisma.message.create({
      data: {
        bookingId,
        direction: "OUTBOUND",
        author,
        body: text,
        language,
        twilioSid: sid,
        deliveryStatus: sid ? "queued" : "dry-run",
      },
    });
    return true;
  } catch (e) {
    await prisma.message.create({
      data: {
        bookingId,
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
  booking: { id: string; guestName: string | null; checkIn: Date; checkOut: Date; guests: number | null },
  apartmentName: string,
  inboundId: string,
  e: { reason: string; urgent: boolean; hostSummary: string; sendFailed: boolean }
) {
  await prisma.message.update({
    where: { id: inboundId },
    data: {
      escalated: true,
      urgent: e.urgent,
      escalationReason: e.reason.slice(0, 300),
      hostSummary: e.hostSummary.slice(0, 600),
    },
  });
  // At most one email per booking per 30 minutes, unless urgent.
  const recent = await prisma.message.count({
    where: {
      bookingId: booking.id,
      escalated: true,
      resolved: false,
      id: { not: inboundId },
      createdAt: { gte: new Date(Date.now() - 30 * 60_000) },
    },
  });
  if (e.urgent || recent === 0) {
    await notifyHost({
      to: owner.email,
      subject: `${e.urgent ? "URGENT: " : ""}A guest needs you at ${apartmentName}`,
      text: `${e.hostSummary}\n\nOpen: ${process.env.APP_URL}/inbox/${booking.id}`,
    });
  }
}

async function updateLanguage(bookingId: string, current: string | null, text: string, detected: string | null) {
  // A guess from a very short message ("ok") must not overwrite the language the host chose.
  if (!detected || text.trim().length < 15 || detected === current) return;
  await prisma.booking.update({ where: { id: bookingId }, data: { guestLanguage: detected } });
}

async function handleUnmatched(ownerId: string, phone: string, sid: string, body: string, hasMedia: boolean, now: Date) {
  try {
    await prisma.unmatchedMessage.create({
      data: { ownerId, phone, body, hasMedia, twilioSid: sid },
    });
  } catch (e) {
    if (isUnique(e)) return;
    throw e;
  }
  const hourAgo = new Date(now.getTime() - HOUR);
  const dayAgo = new Date(now.getTime() - 24 * HOUR);
  const [lastHour, repliedToday] = await Promise.all([
    prisma.unmatchedMessage.count({
      where: { ownerId, phone, receivedAt: { gte: hourAgo } },
    }),
    prisma.unmatchedMessage.count({
      where: { ownerId, phone, repliedAt: { gte: dayAgo } },
    }),
  ]);
  if (lastHour > 5 || repliedToday > 0) return; // no AI, one canned reply per number per day
  try {
    await sendWhatsApp({ to: phone, text: UNMATCHED_REPLY });
    await prisma.unmatchedMessage.update({ where: { twilioSid: sid }, data: { repliedAt: now } });
  } catch {
    /* nothing to do: the message is stored for the host */
  }
}
