"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import {
  apartmentSchema, feedSchema, settingsSchema, isSafeFeedUrl, toCents,
} from "@/lib/validation";
import { syncFeed } from "@/lib/sync";

export type FormState =
  | { error?: string; fieldErrors?: Record<string, string[] | undefined>; ok?: boolean }
  | undefined;

function apartmentData(formData: FormData) {
  const parsed = apartmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { state: { fieldErrors: parsed.error.flatten().fieldErrors } as FormState };
  }
  const { baseNightlyEuros, cleaningFeeEuros, ...rest } = parsed.data;
  return {
    data: {
      ...rest,
      baseNightlyCents: toCents(baseNightlyEuros),
      cleaningFeeCents: toCents(cleaningFeeEuros),
    },
  };
}

export async function createApartment(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireOwner();
  const r = apartmentData(formData);
  if (!r.data) return r.state;
  const apartment = await prisma.apartment.create({ data: { ...r.data, ownerId: session.user.id } });
  revalidatePath("/apartments");
  redirect(`/apartments/${apartment.id}`);
}

export async function updateApartment(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireOwner();
  const r = apartmentData(formData);
  if (!r.data) return r.state;
  const { count } = await prisma.apartment.updateMany({
    where: { id, ownerId: session.user.id }, // ownership enforced in the query
    data: r.data,
  });
  if (count === 0) notFound();
  revalidatePath(`/apartments/${id}`);
  revalidatePath("/apartments");
  return { ok: true };
}

export async function deleteApartment(id: string): Promise<void> {
  const session = await requireOwner();
  const { count } = await prisma.apartment.deleteMany({ where: { id, ownerId: session.user.id } });
  if (count === 0) notFound();
  revalidatePath("/apartments");
  redirect("/apartments");
}

export async function addFeed(apartmentId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireOwner();
  const apartment = await prisma.apartment.findFirst({
    where: { id: apartmentId, ownerId: session.user.id },
    include: { _count: { select: { feeds: true } } },
  });
  if (!apartment) notFound();
  if (apartment._count.feeds >= 5) return { error: "Maximum 5 calendar links per apartment." };

  const parsed = feedSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  if (!isSafeFeedUrl(parsed.data.icalUrl)) {
    return { fieldErrors: { icalUrl: ["Use the https calendar link from Airbnb or Booking.com."] } };
  }
  const feed = await prisma.calendarFeed.create({ data: { apartmentId, ...parsed.data } });
  revalidatePath(`/apartments/${apartmentId}`);

  // Run initial sync immediately
  const r = await syncFeed(feed.id);
  if (!r.ok) {
    return { error: `Saved, but the first sync failed: ${r.error ?? "Unknown error"}` };
  }
  return { ok: true };
}

export async function removeFeed(feedId: string, apartmentId: string): Promise<void> {
  const session = await requireOwner();
  const feed = await prisma.calendarFeed.findFirst({
    where: { id: feedId, apartment: { ownerId: session.user.id } },
  });
  if (!feed) return;
  await prisma.$transaction([
    prisma.booking.updateMany({
      where: { calendarFeedId: feed.id, status: "CONFIRMED", checkOut: { gt: new Date() } },
      data: { status: "CANCELLED" },
    }),
    prisma.calendarFeed.delete({ where: { id: feed.id } }), // bookings keep history (SetNull)
  ]);
  revalidatePath(`/apartments/${apartmentId}`);
}

export async function updateSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireOwner();
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  await prisma.owner.update({ where: { id: session.user.id }, data: parsed.data });
  revalidatePath("/settings");
  return { ok: true };
}

export async function syncFeedNow(feedId: string): Promise<{ ok: boolean; message: string }> {
  const owner = await requireOwner();
  const feed = await prisma.calendarFeed.findFirst({
    where: { id: feedId, apartment: { ownerId: owner.user.id } },
  });
  if (!feed) notFound();
  if (feed.lastSyncAt && Date.now() - feed.lastSyncAt.getTime() < 60_000) {
    return { ok: false, message: "Synced less than a minute ago." };
  }
  const r = await syncFeed(feedId);
  const updatedFeed = await prisma.calendarFeed.findUnique({ where: { id: feedId } });
  revalidatePath(`/apartments/${updatedFeed?.apartmentId ?? feed.apartmentId}`);
  return r.ok
    ? { ok: true, message: `Done: ${r.created} new, ${r.updated} changed, ${r.cancelled} cancelled.` }
    : { ok: false, message: r.error ?? "Sync failed." };
}
