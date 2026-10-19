"use server";

import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { answerGuest, buildHistory } from "@/lib/assistant";
import { detailsUnlocked } from "@/lib/inbound-match";
import { todayMalta } from "@/lib/dates";

export type TestResult = {
  reply: string;
  language: string | null;
  escalate: boolean;
  urgent: boolean;
  reason: string;
  hostSummary: string;
  optOut: boolean;
  error?: string;
};

export async function testAssistant(
  apartmentId: string,
  message: string,
  pretendGuestArrivesInAFewDays: boolean
): Promise<TestResult> {
  const owner = await requireOwner();

  const apartment = await prisma.apartment.findFirst({
    where: { id: apartmentId, ownerId: owner.user.id },
  });

  if (!apartment) {
    return { reply: "", language: null, escalate: false, urgent: false, reason: "", hostSummary: "", optOut: false, error: "Apartment not found" };
  }

  const now = new Date();
  const checkIn = pretendGuestArrivesInAFewDays ? new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000) : now;
  const checkOut = new Date(checkIn.getTime() + 3 * 24 * 60 * 60 * 1000);

  const booking = {
    id: "test",
    guestName: "Test Guest",
    checkIn,
    checkOut,
    guests: 2,
  };

  try {
    const result = await answerGuest({
      hostLanguage: owner.user.hostLanguage,
      apartment: {
        name: apartment.name,
        address: apartment.address,
        checkInTime: apartment.checkInTime,
        checkOutTime: apartment.checkOutTime,
        info: apartment.info,
        publicInfo: apartment.publicInfo,
      },
      booking,
      unlocked: !pretendGuestArrivesInAFewDays && detailsUnlocked(booking, now),
      today: todayMalta(now),
      knownLanguage: owner.user.defaultGuestLanguage,
      history: buildHistory([], message),
      allowedText: [apartment.info, apartment.publicInfo, apartment.address, apartment.reviewUrl ?? ""].join("\n"),
    });

    return {
      reply: result.reply,
      language: result.language,
      escalate: result.escalate,
      urgent: result.urgent,
      reason: result.reason,
      hostSummary: result.hostSummary,
      optOut: result.optOut,
    };
  } catch (e) {
    return {
      reply: "",
      language: null,
      escalate: false,
      urgent: false,
      reason: "",
      hostSummary: "",
      optOut: false,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}
