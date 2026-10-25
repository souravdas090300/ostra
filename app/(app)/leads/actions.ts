"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { WhatsAppError, sendWhatsApp } from "@/lib/whatsapp";
import { assertAiBudget, recordUsage } from "@/lib/usage";
import { normaliseLanguage } from "@/lib/languages";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ timeout: 25_000, maxRetries: 1 });

export type PreviewState = {
  translation: string;
  backTranslation: string;
  warnings: string[];
  error?: string;
};

export type SimpleState = {
  error?: string;
  ok?: boolean;
};

export async function previewLeadReply(
  leadId: string,
  text: string,
): Promise<PreviewState> {
  const session = await requireOwner();
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, ownerId: session.user.id },
    select: { language: true },
  });
  if (!lead) return { translation: "", backTranslation: "", warnings: ["Lead not found"], error: "Lead not found" };

  const guestLanguage = lead.language ?? session.user.defaultGuestLanguage;
  const hostLanguage = session.user.hostLanguage;

  if (guestLanguage === hostLanguage) {
    return { translation: text, backTranslation: text, warnings: [] };
  }

  try {
    const msg = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
      max_tokens: 400,
      system: `You are a translator. Translate the following message from ${hostLanguage} to ${guestLanguage}. Return only the translation, nothing else.`,
      messages: [{ role: "user", content: text }],
    });
    const translation = msg.content[0]?.type === "text" ? msg.content[0].text : text;

    // Back-translate to check
    const backMsg = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
      max_tokens: 400,
      system: `You are a translator. Translate the following message from ${guestLanguage} to ${hostLanguage}. Return only the translation, nothing else.`,
      messages: [{ role: "user", content: translation }],
    });
    const backTranslation = backMsg.content[0]?.type === "text" ? backMsg.content[0].text : translation;

    const warnings: string[] = [];
    if (backTranslation.toLowerCase() !== text.toLowerCase()) {
      warnings.push("The back-translation differs from your original. Please review carefully.");
    }

    await recordUsage(session.user.id, "AI_TRANSLATE", {
      input: msg.usage.input_tokens,
      output: msg.usage.output_tokens,
    });
    await recordUsage(session.user.id, "AI_TRANSLATE", {
      input: backMsg.usage.input_tokens,
      output: backMsg.usage.output_tokens,
    });

    return { translation, backTranslation, warnings };
  } catch {
    return { translation: text, backTranslation: text, warnings: ["Translation failed - sending original text"] };
  }
}

export async function recheckLeadTranslation(
  leadId: string,
  translation: string,
  original: string,
): Promise<PreviewState> {
  const session = await requireOwner();
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, ownerId: session.user.id },
    select: { language: true },
  });
  if (!lead) return { translation, backTranslation: "", warnings: ["Lead not found"], error: "Lead not found" };

  const guestLanguage = lead.language ?? session.user.defaultGuestLanguage;
  const hostLanguage = session.user.hostLanguage;

  if (guestLanguage === hostLanguage) {
    return { translation, backTranslation: translation, warnings: [] };
  }

  try {
    const backMsg = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
      max_tokens: 400,
      system: `You are a translator. Translate the following message from ${guestLanguage} to ${hostLanguage}. Return only the translation, nothing else.`,
      messages: [{ role: "user", content: translation }],
    });
    const backTranslation = backMsg.content[0]?.type === "text" ? backMsg.content[0].text : translation;

    const warnings: string[] = [];
    if (backTranslation.toLowerCase() !== original.toLowerCase()) {
      warnings.push("The back-translation differs from your original. Please review carefully.");
    }

    await recordUsage(session.user.id, "AI_TRANSLATE", {
      input: backMsg.usage.input_tokens,
      output: backMsg.usage.output_tokens,
    });

    return { translation, backTranslation, warnings };
  } catch {
    return { translation, backTranslation: original, warnings: ["Back-translation failed"] };
  }
}

export async function sendLeadReply(
  leadId: string,
  text: string,
  original: string,
  markResolved: boolean,
): Promise<SimpleState> {
  const session = await requireOwner();
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, ownerId: session.user.id },
    include: { apartment: true },
  });
  if (!lead) return { error: "Lead not found" };

  try {
    const { sid } = await sendWhatsApp({
      to: lead.phone,
      text,
      ownerId: session.user.id,
      kind: "WA_FREEFORM",
    });

    await prisma.leadMessage.create({
      data: {
        leadId,
        direction: "OUTBOUND",
        author: "HOST",
        body: text,
        originalBody: text !== original ? original : null,
        language: lead.language ?? session.user.defaultGuestLanguage,
        twilioSid: sid,
        deliveryStatus: sid ? "queued" : "dry-run",
      },
    });

    if (markResolved) {
      await prisma.leadMessage.updateMany({
        where: { leadId, escalated: true, resolved: false },
        data: { resolved: true, resolvedAt: new Date() },
      });
    }

    await prisma.lead.update({
      where: { id: leadId },
      data: { lastOutboundAt: new Date() },
    });

    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/leads");
    return { ok: true };
  } catch (e) {
    await prisma.leadMessage.create({
      data: {
        leadId,
        direction: "OUTBOUND",
        author: "HOST",
        body: text,
        originalBody: text !== original ? original : null,
        language: lead.language ?? session.user.defaultGuestLanguage,
        deliveryStatus: "failed",
        errorCode: e instanceof WhatsAppError ? e.code ?? null : null,
      },
    });
    return { error: "Failed to send message" };
  }
}

export async function resolveLeadConversation(leadId: string): Promise<void> {
  const session = await requireOwner();
  await prisma.leadMessage.updateMany({
    where: {
      leadId,
      escalated: true,
      resolved: false,
      lead: { ownerId: session.user.id },
    },
    data: { resolved: true, resolvedAt: new Date() },
  });
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
}

export async function reopenLeadMessage(messageId: string): Promise<void> {
  const session = await requireOwner();
  const message = await prisma.leadMessage.findFirst({
    where: { id: messageId, lead: { ownerId: session.user.id } },
  });
  if (!message) return;

  await prisma.leadMessage.update({
    where: { id: messageId },
    data: { resolved: false, resolvedAt: null },
  });
  revalidatePath(`/leads/${message.leadId}`);
  revalidatePath("/leads");
}

export async function convertLeadToBooking(
  leadId: string,
  apartmentId: string,
  checkIn: string,
  checkOut: string,
  guests: number,
  guestName: string,
): Promise<SimpleState> {
  const session = await requireOwner();

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, ownerId: session.user.id },
  });
  if (!lead) return { error: "Lead not found" };

  const apartment = await prisma.apartment.findFirst({
    where: { id: apartmentId, ownerId: session.user.id },
  });
  if (!apartment) return { error: "Apartment not found" };

  const checkInDate = new Date(checkIn);
  const checkOutDate = new Date(checkOut);

  if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime())) {
    return { error: "Invalid dates" };
  }

  if (checkOutDate <= checkInDate) {
    return { error: "Check-out must be after check-in" };
  }

  try {
    const booking = await prisma.booking.create({
      data: {
        apartmentId,
        source: "DIRECT",
        status: "CONFIRMED",
        checkIn: checkInDate,
        checkOut: checkOutDate,
        guestName,
        guestPhone: lead.phone,
        guestLanguage: lead.language,
        guests,
        optedInAt: new Date(),
      },
    });

    // Update lead
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        status: "BOOKED",
        bookingId: booking.id,
        convertedBookingId: booking.id,
      },
    });

    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/leads");
    revalidatePath("/bookings");
    return { ok: true };
  } catch (e) {
    return { error: "Failed to create booking" };
  }
}
