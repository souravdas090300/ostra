import { prisma } from "./db";

export async function eraseGuestData(ownerId: string, bookingId: string, scope: "booking" | "phone") {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { apartment: true },
  });

  if (!booking || booking.apartment.ownerId !== ownerId) {
    throw new Error("Booking not found");
  }

  let bookingIds = [bookingId];
  if (scope === "phone" && booking.guestPhone) {
    const samePhone = await prisma.booking.findMany({
      where: {
        apartment: { ownerId },
        guestPhone: booking.guestPhone,
      },
      select: { id: true },
    });
    bookingIds = samePhone.map((b) => b.id);
  }

  const phone = booking.guestPhone;

  const result = await prisma.$transaction([
    prisma.message.deleteMany({ where: { bookingId: { in: bookingIds } } }),
    prisma.scheduledMessage.deleteMany({ where: { bookingId: { in: bookingIds } } }),
    prisma.unmatchedMessage.deleteMany({
      where: {
        ownerId,
        phone: phone ?? undefined,
        linkedBookingId: { in: bookingIds },
      },
    }),
    prisma.booking.updateMany({
      where: { id: { in: bookingIds } },
      data: {
        guestName: null,
        guestPhone: null,
        guestLanguage: null,
        notes: null,
        optedInAt: null,
        anonymisedAt: new Date(),
      },
    }),
    prisma.auditLog.create({
      data: {
        ownerId,
        action: "ERASE_GUEST",
        targetType: "booking",
        targetId: bookingId,
      },
    }),
  ]);

  return { bookingsAffected: bookingIds.length };
}

export async function collectGuestData(ownerId: string, bookingIds: string[]) {
  const bookings = await prisma.booking.findMany({
    where: { id: { in: bookingIds }, apartment: { ownerId } },
    include: {
      apartment: { select: { name: true } },
      messages: true,
      scheduled: true,
    },
  });

  if (bookings.length === 0) {
    throw new Error("No bookings found");
  }

  const phones = bookings.filter((b) => b.guestPhone).map((b) => b.guestPhone!);
  const unmatched = phones.length > 0
    ? await prisma.unmatchedMessage.findMany({
        where: { ownerId, phone: { in: phones } },
      })
    : [];

  return {
    bookings: bookings.map((b) => ({
      id: b.id,
      apartmentName: b.apartment.name,
      source: b.source,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      guestName: b.guestName,
      guestPhone: b.guestPhone,
      guestLanguage: b.guestLanguage,
      notes: b.notes,
      optedInAt: b.optedInAt,
      optedOutAt: b.optedOutAt,
      messages: b.messages.map((m) => ({
        direction: m.direction,
        author: m.author,
        body: m.body,
        originalBody: m.originalBody,
        language: m.language,
        createdAt: m.createdAt,
        deliveryStatus: m.deliveryStatus,
      })),
      scheduledMessages: b.scheduled.map((s) => ({
        type: s.type,
        sendAt: s.sendAt,
        status: s.status,
        lastError: s.lastError,
      })),
    })),
    unmatchedMessages: unmatched.map((m) => ({
      phone: m.phone,
      body: m.body,
      receivedAt: m.receivedAt,
    })),
  };
}
