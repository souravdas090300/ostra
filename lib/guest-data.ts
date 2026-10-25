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

export async function eraseLeadData(ownerId: string, leadId: string, scope: "lead" | "phone") {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
  });

  if (!lead || lead.ownerId !== ownerId) {
    throw new Error("Lead not found");
  }

  let leadIds = [leadId];
  if (scope === "phone") {
    const samePhone = await prisma.lead.findMany({
      where: {
        ownerId,
        phone: lead.phone,
      },
      select: { id: true },
    });
    leadIds = samePhone.map((l) => l.id);
  }

  const phone = lead.phone;

  const result = await prisma.$transaction([
    prisma.leadMessage.deleteMany({ where: { leadId: { in: leadIds } } }),
    prisma.unmatchedMessage.deleteMany({
      where: {
        ownerId,
        phone: phone ?? undefined,
      },
    }),
    prisma.lead.updateMany({
      where: { id: { in: leadIds } },
      data: {
        name: null,
        phone: null,
        notes: null,
        checkIn: null,
        checkOut: null,
        guests: null,
        quotedCents: null,
        needsHostReason: null,
        hostSummary: null,
        language: null,
        status: "LOST",
      },
    }),
    prisma.auditLog.create({
      data: {
        ownerId,
        action: "ERASE_LEAD",
        targetType: "lead",
        targetId: leadId,
      },
    }),
  ]);

  return { leadsAffected: leadIds.length };
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

export async function collectLeadData(ownerId: string, leadIds: string[]) {
  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds }, ownerId },
    include: {
      apartment: { select: { name: true } },
      messages: true,
    },
  });

  if (leads.length === 0) {
    throw new Error("No leads found");
  }

  return {
    leads: leads.map((l) => ({
      id: l.id,
      phone: l.phone,
      name: l.name,
      status: l.status,
      checkIn: l.checkIn,
      checkOut: l.checkOut,
      guests: l.guests,
      apartmentName: l.apartment?.name,
      quotedCents: l.quotedCents,
      language: l.language,
      notes: l.notes,
      hostSummary: l.hostSummary,
      needsHostReason: l.needsHostReason,
      urgent: l.urgent,
      lastInboundAt: l.lastInboundAt,
      lastOutboundAt: l.lastOutboundAt,
      messages: l.messages.map((m) => ({
        direction: m.direction,
        author: m.author,
        body: m.body,
        originalBody: m.originalBody,
        language: m.language,
        createdAt: m.createdAt,
        deliveryStatus: m.deliveryStatus,
        escalated: m.escalated,
        urgent: m.urgent,
        resolved: m.resolved,
      })),
    })),
  };
}
