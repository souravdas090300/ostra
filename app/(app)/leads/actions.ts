"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { WhatsAppError, sendWhatsApp } from "@/lib/whatsapp";
import { assertAiBudget, recordUsage } from "@/lib/usage";
import { normaliseLanguage } from "@/lib/languages";
import { translateText, missingTokens, ReplyTranslationError } from "@/lib/translate-reply";
import { rateLimit } from "@/lib/rate-limit";
import { validateDateRange, MAX_TEXT, SimpleState, PreviewState, saveOriginalBody } from "@/lib/validation";
import { reportError } from "@/lib/report-error";

export async function previewLeadReply(
  leadId: string,
  text: string,
): Promise<PreviewState> {
  const session = await requireOwner();
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, ownerId: session.id },
    select: { language: true },
  });
  if (!lead) return { translation: "", backTranslation: "", warnings: ["Lead not found"], error: "Lead not found" };

  const guestLanguage = lead.language ?? session.defaultGuestLanguage;
  const hostLanguage = session.hostLanguage;

  if (guestLanguage === hostLanguage) {
    return { translation: text, backTranslation: text, warnings: [] };
  }

  if (!rateLimit(`translate:${session.id}`, 60, 3_600_000)) {
    return { translation: text, backTranslation: text, warnings: ["Too many translations this hour. Try again later."], error: "Too many translations this hour. Try again later." };
  }

  try {
    const translation = await translateText(text, hostLanguage, guestLanguage, session.id);
    const backTranslation = await translateText(translation, guestLanguage, hostLanguage, session.id);
    const missing = missingTokens(text, translation);
    const warnings = missing.length ? [`These were changed or missing in the translation, check them: ${missing.join(", ")}`] : [];
    return { translation, backTranslation, warnings };
  } catch (e) {
    reportError(e, { context: "previewLeadReply", leadId });
    return { translation: text, backTranslation: text, warnings: ["Translation failed - sending original text"], error: e instanceof ReplyTranslationError ? e.message : "Could not translate right now." };
  }
}

export async function recheckLeadTranslation(
  leadId: string,
  translation: string,
  original: string,
): Promise<PreviewState> {
  const session = await requireOwner();
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, ownerId: session.id },
    select: { language: true },
  });
  if (!lead) return { translation, backTranslation: "", warnings: ["Lead not found"], error: "Lead not found" };

  const guestLanguage = lead.language ?? session.defaultGuestLanguage;
  const hostLanguage = session.hostLanguage;

  if (guestLanguage === hostLanguage) {
    return { translation, backTranslation: translation, warnings: [] };
  }

  if (!rateLimit(`translate:${session.id}`, 60, 3_600_000)) {
    return { translation, backTranslation: original, warnings: ["Too many translations this hour. Try again later."], error: "Too many translations this hour. Try again later." };
  }

  try {
    const backTranslation = await translateText(translation.slice(0, MAX_TEXT), guestLanguage, hostLanguage, session.id);
    const missing = missingTokens(original, translation);
    const warnings = missing.length ? [`These were changed or missing, check them: ${missing.join(", ")}`] : [];
    return { translation, backTranslation, warnings };
  } catch (e) {
    reportError(e, { context: "recheckLeadTranslation", leadId });
    return { translation, backTranslation: original, warnings: ["Back-translation failed"], error: e instanceof ReplyTranslationError ? e.message : "Could not check right now." };
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
    where: { id: leadId, ownerId: session.id },
    include: { apartment: true },
  });
  if (!lead) return { error: "Lead not found" };

  const body = text.trim();
  if (!body) return { error: "Write a message first." };
  if (body.length > MAX_TEXT) return { error: `Keep it under ${MAX_TEXT} characters.` };

  try {
    const { sid } = await sendWhatsApp({
      to: lead.phone,
      text: body,
      ownerId: session.id,
      kind: "WA_FREEFORM",
    });

    await prisma.leadMessage.create({
      data: {
        leadId,
        direction: "OUTBOUND",
        author: "HOST",
        body,
        originalBody: saveOriginalBody(original, body),
        language: lead.language ?? session.defaultGuestLanguage,
        metaMessageId: sid,
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
        body,
        originalBody: saveOriginalBody(original, body),
        language: lead.language ?? session.defaultGuestLanguage,
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
      lead: { ownerId: session.id },
    },
    data: { resolved: true, resolvedAt: new Date() },
  });
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
}

export async function reopenLeadMessage(messageId: string): Promise<void> {
  const session = await requireOwner();
  const message = await prisma.leadMessage.findFirst({
    where: { id: messageId, lead: { ownerId: session.id } },
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
    where: { id: leadId, ownerId: session.id },
  });
  if (!lead) return { error: "Lead not found" };

  const apartment = await prisma.apartment.findFirst({
    where: { id: apartmentId, ownerId: session.id },
  });
  if (!apartment) return { error: "Apartment not found" };

  const validationErrors = validateDateRange(checkIn, checkOut);
  if (validationErrors) {
    const error = validationErrors.fieldErrors?.endDate?.[0] || validationErrors.fieldErrors?.startDate?.[0] || "Invalid dates";
    return { error };
  }

  const checkInDate = new Date(checkIn);
  const checkOutDate = new Date(checkOut);

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
