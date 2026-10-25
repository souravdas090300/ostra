"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { maltaLocalToUtc, maltaYmd } from "@/lib/time";
import { todayMalta } from "@/lib/dates";
import { parseContact, parseStayDates } from "@/lib/booking-validation";
import { findOverlaps, type Overlap } from "@/lib/booking-overlaps";
import { rescheduleBookings } from "@/lib/schedule";
import { phoneIsOptedOut } from "@/lib/optout";
import { echo } from "@/lib/validation";

export type BookingFormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string[] | undefined>;
      overlaps?: Overlap[];
      landline?: boolean;
      ok?: boolean;
      submitted?: Record<string, string>; // echo, because React resets uncontrolled inputs after an action
    }
  | undefined;

const nullify = <T,>(v: T | undefined) => (v === undefined ? null : v);

export async function createBooking(_p: BookingFormState, fd: FormData): Promise<BookingFormState> {
  const owner = await requireOwner();
  const submitted = echo(fd);

  const apartment = await prisma.apartment.findFirst({
    where: { id: String(fd.get("apartmentId") ?? ""), ownerId: owner.id },
  });
  if (!apartment) return { fieldErrors: { apartmentId: ["Choose an apartment."] }, submitted };

  const contact = parseContact(fd);
  const dates = parseStayDates(fd, todayMalta());
  const fieldErrors = { ...contact.fieldErrors, ...(dates.ok ? {} : dates.fieldErrors) };
  if (!contact.data || !dates.ok || Object.keys(fieldErrors).length) return { fieldErrors, submitted };

  // Check opt-out
  if (contact.data.guestPhone && (await phoneIsOptedOut(owner.id, contact.data.guestPhone))) {
    return { fieldErrors: { guestPhone: ["This number has opted out of messages."] }, submitted };
  }

  const overlaps = await findOverlaps(owner.id, apartment.id, dates.inYmd, dates.outYmd);
  if (overlaps.length && fd.get("confirmOverlap") !== "1") return { overlaps, submitted, landline: contact.landline };

  const guestOptIn = fd.get("guestOptIn") === "true";

  const booking = await prisma.booking.create({
    data: {
      apartmentId: apartment.id,
      source: "DIRECT",
      status: "CONFIRMED",
      isBlock: false,
      checkIn: maltaLocalToUtc(dates.inYmd, apartment.checkInTime),
      checkOut: maltaLocalToUtc(dates.outYmd, apartment.checkOutTime),
      guestName: nullify(contact.data.guestName),
      guestPhone: nullify(contact.data.guestPhone),
      guestLanguage: nullify(contact.data.guestLanguage),
      guests: nullify(contact.data.guests),
      notes: nullify(contact.data.notes),
      optedInAt: contact.data.guestPhone && guestOptIn ? new Date() : null,
      optedOutAt: contact.data.guestPhone && (await phoneIsOptedOut(owner.id, contact.data.guestPhone)) ? new Date() : null,
    },
  });
  await rescheduleBookings([booking.id]);
  revalidatePath("/calendar");
  redirect(`/bookings/${booking.id}?created=1`);
}

export async function updateBooking(id: string, _p: BookingFormState, fd: FormData): Promise<BookingFormState> {
  const owner = await requireOwner();
  const submitted = echo(fd);
  const b = await prisma.booking.findFirst({
    where: { id, apartment: { ownerId: owner.id } }, // ownership enforced in the query
    include: { apartment: true },
  });
  if (!b) notFound();
  if (b.isBlock) return { error: "Blocked dates cannot be edited.", submitted };
  if (b.status === "CANCELLED") return { error: "This booking is cancelled.", submitted };

  const contact = parseContact(fd);
  if (!contact.data || Object.keys(contact.fieldErrors).length) return { fieldErrors: contact.fieldErrors, submitted };

  // Check opt-out if trying to opt in
  const guestOptIn = fd.get("guestOptIn") === "true";
  if (contact.data.guestPhone && guestOptIn && (await phoneIsOptedOut(owner.id, contact.data.guestPhone))) {
    return { fieldErrors: { guestPhone: ["This number has opted out of messages."] }, submitted };
  }

  const data: Record<string, unknown> = {
    guestName: nullify(contact.data.guestName),
    guestPhone: nullify(contact.data.guestPhone),
    guestLanguage: nullify(contact.data.guestLanguage),
    guests: nullify(contact.data.guests),
    notes: nullify(contact.data.notes),
  };
  let datesChanged = false;
  let optInChanged = false;

  // Handle opt-in/opt-out
  if (contact.data.guestPhone) {
    if (guestOptIn && !b.optedInAt) {
      data.optedInAt = new Date();
      optInChanged = true;
    } else if (!guestOptIn && b.optedInAt) {
      data.optedInAt = null;
      optInChanged = true;
    }
  } else {
    data.optedInAt = null;
    optInChanged = b.optedInAt !== null;
  }

  if (b.source === "DIRECT") {
    // Only direct bookings read date fields. Synced bookings ignore them completely.
    const dates = parseStayDates(fd, todayMalta());
    if (!dates.ok) return { fieldErrors: dates.fieldErrors, submitted };
    const overlaps = await findOverlaps(owner.id, b.apartmentId, dates.inYmd, dates.outYmd, b.id);
    if (overlaps.length && fd.get("confirmOverlap") !== "1") return { overlaps, submitted, landline: contact.landline };
    const checkIn = maltaLocalToUtc(dates.inYmd, b.apartment.checkInTime);
    const checkOut = maltaLocalToUtc(dates.outYmd, b.apartment.checkOutTime);
    datesChanged = checkIn.getTime() !== b.checkIn.getTime() || checkOut.getTime() !== b.checkOut.getTime();
    data.checkIn = checkIn;
    data.checkOut = checkOut;
  }

  await prisma.booking.update({ where: { id: b.id }, data });
  const reschedule =
    datesChanged ||
    (contact.data.guestPhone ?? null) !== b.guestPhone ||
    (contact.data.guestLanguage ?? null) !== b.guestLanguage ||
    optInChanged;
  if (reschedule) await rescheduleBookings([b.id]);

  revalidatePath(`/bookings/${b.id}`);
  revalidatePath("/calendar");
  return { ok: true, landline: contact.landline };
}

export async function cancelDirectBooking(id: string): Promise<BookingFormState> {
  const owner = await requireOwner();
  const b = await prisma.booking.findFirst({ where: { id, apartment: { ownerId: owner.id } } });
  if (!b) notFound();
  if (b.source !== "DIRECT") return { error: "Cancel this booking on Airbnb or Booking.com. Ostra will update within the hour." };
  if (b.status === "CANCELLED") return { ok: true };
  await prisma.booking.update({ where: { id: b.id }, data: { status: "CANCELLED" } });
  await rescheduleBookings([b.id]); // Phase 6 removes unsent scheduled messages
  revalidatePath("/calendar");
  redirect("/calendar");
}

export async function restoreDirectBooking(id: string, _p: BookingFormState, fd: FormData): Promise<BookingFormState> {
  const owner = await requireOwner();
  const b = await prisma.booking.findFirst({ where: { id, apartment: { ownerId: owner.id } } });
  if (!b) notFound();
  if (b.source !== "DIRECT" || b.status !== "CANCELLED") return { error: "Only cancelled direct bookings can be restored." };
  const overlaps = await findOverlaps(owner.id, b.apartmentId, maltaYmd(b.checkIn), maltaYmd(b.checkOut), b.id);
  if (overlaps.length && fd.get("confirmOverlap") !== "1") return { overlaps };
  await prisma.booking.update({ where: { id: b.id }, data: { status: "CONFIRMED" } });
  await rescheduleBookings([b.id]);
  revalidatePath(`/bookings/${b.id}`);
  revalidatePath("/calendar");
  return { ok: true };
}

export async function setMessagesPaused(id: string, paused: boolean): Promise<void> {
  const owner = await requireOwner();
  const { count } = await prisma.booking.updateMany({
    where: { id, isBlock: false, apartment: { ownerId: owner.id } },
    data: { messagesPaused: paused },
  });
  if (count === 0) notFound();
  await rescheduleBookings([id]);
  revalidatePath(`/bookings/${id}`);
}

export async function skipScheduledMessage(scheduledMessageId: string): Promise<void> {
  const owner = await requireOwner();
  const message = await prisma.scheduledMessage.findFirst({
    where: {
      id: scheduledMessageId,
      booking: { apartment: { ownerId: owner.id } },
    },
  });
  if (!message) notFound();
  await prisma.scheduledMessage.update({
    where: { id: scheduledMessageId },
    data: {
      status: "SKIPPED",
      skipReason: "Skipped by host",
      hostSkipped: true,
    },
  });
  revalidatePath(`/bookings/${message.bookingId}`);
}

export type SkipFormState = {
  error?: string;
  ok?: boolean;
} | undefined;
