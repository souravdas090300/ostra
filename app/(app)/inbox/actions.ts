"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { loadThread } from "@/lib/inbox-data";
import { resolveGuestLanguage, windowOpen } from "@/lib/reply-window";
import { rateLimit } from "@/lib/rate-limit";
import { missingTokens, translateText, ReplyTranslationError } from "@/lib/translate-reply";
import { WhatsAppError, sendWhatsApp } from "@/lib/whatsapp";
import { answerInbound } from "@/lib/inbound";
import { rescheduleBookings } from "@/lib/schedule";
import { log } from "@/lib/log";
import { echo, MAX_TEXT, SimpleState, InboxPreviewState, saveOriginalBody } from "@/lib/validation";

export type PreviewState = InboxPreviewState;

async function ownThread(bookingId: string) {
  const session = await requireOwner();
  const t = await loadThread(session.id, bookingId);
  if (!t) notFound();
  return { session, t };
}

/** Step 1: translate the host's text and translate it back so she can check what the guest will read. */
export async function previewReply(bookingId: string, text: string): Promise<PreviewState> {
  const { session, t } = await ownThread(bookingId);
  const clean = text.trim();
  if (!clean) return { error: "Write a message first." };
  if (clean.length > MAX_TEXT) return { error: `Keep it under ${MAX_TEXT} characters.` };
  const guestLanguage = resolveGuestLanguage(t.booking.guestLanguage, t.lastDetected, session.defaultGuestLanguage);
  if (guestLanguage === session.hostLanguage) return { ok: true, sameLanguage: true, guestLanguage };
  if (!rateLimit(`translate:${session.id}`, 60, 3_600_000)) return { error: "Too many translations this hour. Try again later." };
  try {
    const translation = await translateText(clean, session.hostLanguage, guestLanguage, session.id);
    const backTranslation = await translateText(translation, guestLanguage, session.hostLanguage, session.id);
    const missing = missingTokens(clean, translation);
    return {
      ok: true,
      guestLanguage,
      translation,
      backTranslation,
      warnings: missing.length ? [`These were changed or missing in the translation, check them: ${missing.join(", ")}`] : [],
    };
  } catch (e) {
    return { error: e instanceof ReplyTranslationError ? e.message : "Could not translate right now." };
  }
}

/** Re-check a translation the host edited by hand. */
export async function recheckTranslation(bookingId: string, edited: string, original: string): Promise<PreviewState> {
  const { session, t } = await ownThread(bookingId);
  const guestLanguage = resolveGuestLanguage(t.booking.guestLanguage, t.lastDetected, session.defaultGuestLanguage);
  if (!rateLimit(`translate:${session.id}`, 60, 3_600_000)) return { error: "Too many translations this hour. Try again later." };
  try {
    const backTranslation = await translateText(edited.slice(0, MAX_TEXT), guestLanguage, session.hostLanguage, session.id);
    const missing = missingTokens(original, edited);
    return {
      ok: true,
      guestLanguage,
      translation: edited,
      backTranslation,
      warnings: missing.length ? [`These were changed or missing, check them: ${missing.join(", ")}`] : [],
    };
  } catch (e) {
    return { error: e instanceof ReplyTranslationError ? e.message : "Could not check right now." };
  }
}

/** Step 2: send. `text` is exactly what the guest will receive; `original` is the host's own-language text. */
export async function sendReply(
  bookingId: string,
  text: string,
  original: string,
  markResolved: boolean,
): Promise<SimpleState> {
  const { session, t } = await ownThread(bookingId);
  const body = text.trim();
  if (!body) return { error: "Write a message first." };
  if (body.length > MAX_TEXT) return { error: `Keep it under ${MAX_TEXT} characters.` };
  if (!t.booking.guestPhone) return { error: "This booking has no phone number." };
  const now = new Date();
  if (!windowOpen(t.lastGuestAt, now)) {
    return {
      error: "The 24-hour reply window has closed. WhatsApp only allows a reply within 24 hours of the guest's last message.",
    };
  }
  if (!rateLimit(`reply:${bookingId}`, 30, 3_600_000)) return { error: "Too many messages sent to this guest this hour." };

  // Double click or double submit: do not send the same text twice within 30 seconds.
  const dup = await prisma.message.findFirst({
    where: {
      bookingId,
      direction: "OUTBOUND",
      author: "HOST",
      body,
      createdAt: { gte: new Date(now.getTime() - 30_000) },
    },
    select: { id: true },
  });
  if (dup) return { ok: true };

  const language = resolveGuestLanguage(t.booking.guestLanguage, t.lastDetected, session.defaultGuestLanguage);
  try {
    const { sid } = await sendWhatsApp({ to: t.booking.guestPhone, text: body });
    await prisma.message.create({
      data: {
        bookingId,
        direction: "OUTBOUND",
        author: "HOST",
        body,
        language,
        originalBody: saveOriginalBody(original, body),
        twilioSid: sid,
        deliveryStatus: sid ? "queued" : "dry-run",
      },
    });
  } catch (e) {
    const code = e instanceof WhatsAppError ? e.code : undefined;
    return { error: `WhatsApp did not accept the message${code ? ` (code ${code})` : ""}. Nothing was sent.` };
  }
  if (markResolved) {
    await prisma.message.updateMany({
      where: { bookingId, escalated: true, resolved: false },
      data: { resolved: true, resolvedAt: now },
    });
  }
  revalidatePath(`/inbox/${bookingId}`);
  revalidatePath("/inbox");
  return { ok: true };
}

export async function resolveConversation(bookingId: string): Promise<void> {
  const { t } = await ownThread(bookingId);
  await prisma.message.updateMany({
    where: { bookingId: t.booking.id, escalated: true, resolved: false },
    data: { resolved: true, resolvedAt: new Date() },
  });
  revalidatePath(`/inbox/${bookingId}`);
  revalidatePath("/inbox");
}

export async function reopenMessage(messageId: string): Promise<void> {
  const session = await requireOwner();
  const { count } = await prisma.message.updateMany({
    where: { id: messageId, escalated: true, booking: { apartment: { ownerId: session.id } } },
    data: { resolved: false, resolvedAt: null, reminderSentAt: null },
  });
  if (count === 0) notFound();
  revalidatePath("/inbox");
}

/** Save a question and answer into the apartment's information so the assistant can use it next time. */
export async function appendToInfo(
  apartmentId: string,
  target: "info" | "publicInfo",
  text: string,
): Promise<SimpleState> {
  const session = await requireOwner();
  const clean = text.trim();
  if (!clean) return { error: "Nothing to save." };
  if (clean.length > 2000) return { error: "Keep it under 2000 characters." };
  const apt = await prisma.apartment.findFirst({ where: { id: apartmentId, ownerId: session.id } });
  if (!apt) notFound();
  const HEADING = "FROM GUEST QUESTIONS";
  const current = apt[target];
  const next = `${current.trimEnd()}${current.includes(HEADING) ? "" : `\n\n${HEADING}`}\n${clean}\n`;
  if (next.length > (target === "info" ? 20000 : 10000)) return { error: "The information is full. Shorten it first." };
  await prisma.apartment.update({ where: { id: apt.id }, data: { [target]: next } });
  revalidatePath(`/apartments/${apt.id}`);
  return { ok: true };
}

export async function dismissUnmatched(id: string): Promise<void> {
  const session = await requireOwner();
  const { count } = await prisma.unmatchedMessage.updateMany({
    where: { id, ownerId: session.id },
    data: { handledAt: new Date() },
  });
  if (count === 0) notFound();
  revalidatePath("/inbox");
}

/** The guest wrote from a different number than the booking's. Attach the number and let the assistant answer. */
export async function linkUnmatchedToBooking(unmatchedId: string, bookingId: string): Promise<SimpleState> {
  const session = await requireOwner();
  const now = new Date();
  const u = await prisma.unmatchedMessage.findFirst({
    where: { id: unmatchedId, ownerId: session.id, handledAt: null },
  });
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, isBlock: false, status: "CONFIRMED", apartment: { ownerId: session.id } },
    include: { apartment: true },
  });
  if (!u || !booking) return { error: "Not found." };
  if (booking.guestPhone && booking.guestPhone !== u.phone) {
    return { error: "This booking already has a different phone number. Change it on the booking first." };
  }

  // Only messages from the last 24 hours (the open reply window), oldest first, at most 5.
  const pending = await prisma.unmatchedMessage.findMany({
    where: {
      ownerId: session.id,
      phone: u.phone,
      handledAt: null,
      receivedAt: { gte: new Date(now.getTime() - 24 * 3_600_000) },
    },
    orderBy: { receivedAt: "asc" },
    take: 5,
  });
  if (pending.length === 0) return { error: "These messages are older than 24 hours, so a reply is no longer possible." };

  await prisma.booking.update({ where: { id: booking.id }, data: { guestPhone: u.phone } });
  let last = null;
  for (const p of pending) {
    last = await prisma.message.create({
      data: {
        bookingId: booking.id,
        direction: "INBOUND",
        author: "GUEST",
        body: p.body,
        hasMedia: p.hasMedia,
        twilioSid: p.twilioSid,
        createdAt: p.receivedAt,
      },
    });
  }
  await prisma.unmatchedMessage.updateMany({
    where: { id: { in: pending.map((p) => p.id) } },
    data: { handledAt: now, linkedBookingId: booking.id },
  });
  await rescheduleBookings([booking.id]); // a phone number was added (opt-in is still required for automatic messages)

  if (last) {
    const inbound = last;
    after(async () => {
      try {
        await answerInbound({
          owner: { id: session.id, email: session.email, hostLanguage: session.hostLanguage, defaultGuestLanguage: session.defaultGuestLanguage },
          booking,
          apartment: booking.apartment,
          inbound,
          from: u.phone,
          now: new Date()
        });
      } catch {
        log("error", "answer after link failed", { bookingId: booking.id });
      }
    });
  }
  revalidatePath("/inbox");
  revalidatePath(`/inbox/${booking.id}`);
  return { ok: true };
}

/** Set or clear feedback on an AI message. Owner-scoped; only works for AI outbound messages. */
export async function setAnswerFeedback(
  messageId: string,
  feedback: "GOOD" | "WRONG" | null,
  note?: string,
): Promise<SimpleState> {
  const session = await requireOwner();

  // Validate feedback value
  if (feedback !== null && feedback !== "GOOD" && feedback !== "WRONG") {
    return { error: "Invalid feedback value." };
  }

  // Validate note length
  if (note && note.length > 300) {
    return { error: "Note must be under 300 characters." };
  }

  // Find the message and verify ownership
  const message = await prisma.message.findFirst({
    where: {
      id: messageId,
      booking: { apartment: { ownerId: session.id } },
    },
  });

  if (!message) return { error: "Message not found." };

  // Only AI outbound messages can have feedback
  if (message.author !== "AI" || message.direction !== "OUTBOUND") {
    return { error: "Feedback can only be set on AI outbound messages." };
  }

  // Update or clear feedback
  await prisma.message.update({
    where: { id: messageId },
    data: {
      feedback,
      feedbackNote: note?.trim() || null,
      feedbackAt: feedback ? new Date() : null,
    },
  });

  revalidatePath("/inbox");
  revalidatePath("/settings/status");
  return { ok: true };
}
