"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { draftReviewReply, type DraftResult } from "@/lib/review-draft";

export type DraftState = {
  success: boolean;
  reply?: string;
  hostTranslation?: string;
  language?: string;
  risk?: "none" | "sensitive" | "legal_or_safety";
  riskNote?: string;
  error?: string;
};

export async function draftReply(formData: FormData): Promise<DraftState> {
  const session = await requireOwner();

  const review = formData.get("review") as string;
  const platform = formData.get("platform") as string;
  const stars = formData.get("stars") ? Number(formData.get("stars")) : undefined;
  const tone = (formData.get("tone") as "warm" | "professional" | "brief") || "warm";
  const language = (formData.get("language") as string) || undefined;
  const maxChars = formData.get("maxChars") ? Number(formData.get("maxChars")) : 700;
  const apartmentId = (formData.get("apartmentId") as string) || undefined;

  if (!review || review.trim().length === 0) {
    return { success: false, error: "Review text is required" };
  }

  if (!platform) {
    return { success: false, error: "Platform is required" };
  }

  // Validate apartment belongs to owner if provided
  if (apartmentId) {
    const apt = await prisma.apartment.findFirst({
      where: { id: apartmentId, ownerId: session.user.id },
    });
    if (!apt) {
      return { success: false, error: "Apartment not found" };
    }
  }

  const result = await draftReviewReply({
    ownerId: session.user.id,
    review: review.trim(),
    stars,
    platform,
    tone,
    language,
    maxChars,
    apartmentId,
  });

  return result;
}
