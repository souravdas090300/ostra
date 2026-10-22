import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../lib/db";
import { eraseGuestData, collectGuestData } from "../lib/guest-data";

describe("guest-data", () => {
  let ownerId: string;
  let apartmentId: string;
  let bookingId: string;
  let bookingId2: string;

  beforeEach(async () => {
    const owner = await prisma.owner.create({
      data: {
        email: "guest-data-test@example.com",
        passwordHash: "hash",
      },
    });
    ownerId = owner.id;

    const apartment = await prisma.apartment.create({
      data: {
        ownerId,
        name: "Test Apt",
        address: "Test Address",
        checkInTime: "14:00",
        checkOutTime: "11:00",
      },
    });
    apartmentId = apartment.id;

    const phone = "+35679123456";

    // Create two bookings with the same phone
    const booking1 = await prisma.booking.create({
      data: {
        apartmentId,
        source: "DIRECT",
        status: "CONFIRMED",
        checkIn: new Date("2026-01-01"),
        checkOut: new Date("2026-01-05"),
        guestName: "Guest One",
        guestPhone: phone,
        guestLanguage: "en",
        notes: "Notes one",
        optedInAt: new Date(),
      },
    });
    bookingId = booking1.id;

    const booking2 = await prisma.booking.create({
      data: {
        apartmentId,
        source: "DIRECT",
        status: "CONFIRMED",
        checkIn: new Date("2026-02-01"),
        checkOut: new Date("2026-02-05"),
        guestName: "Guest Two",
        guestPhone: phone,
        guestLanguage: "de",
        notes: "Notes two",
        optedInAt: new Date(),
      },
    });
    bookingId2 = booking2.id;

    // Add messages to first booking
    await prisma.message.createMany({
      data: [
        {
          bookingId,
          direction: "INBOUND",
          author: "GUEST",
          body: "Message 1",
        },
        {
          bookingId,
          direction: "OUTBOUND",
          author: "AI",
          body: "Reply 1",
        },
      ],
    });

    // Add scheduled message to first booking
    await prisma.scheduledMessage.create({
      data: {
        bookingId,
        type: "PRE_ARRIVAL",
        sendAt: new Date("2026-01-01"),
        status: "PENDING",
      },
    });

    // Add unmatched message linked to the booking
    await prisma.unmatchedMessage.create({
      data: {
        ownerId,
        phone,
        body: "Unmatched",
        twilioSid: "sid123",
        receivedAt: new Date(),
        linkedBookingId: bookingId,
      },
    });
  });

  afterEach(async () => {
    await prisma.message.deleteMany({});
    await prisma.scheduledMessage.deleteMany({});
    await prisma.booking.deleteMany({});
    await prisma.apartment.deleteMany({});
    await prisma.owner.deleteMany({});
    await prisma.unmatchedMessage.deleteMany({});
    await prisma.auditLog.deleteMany({});
  });

  describe("eraseGuestData", () => {
    it("erases guest data for a single booking", async () => {
      const result = await eraseGuestData(ownerId, bookingId, "booking");

      expect(result.bookingsAffected).toBe(1);

      const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
      expect(booking?.guestName).toBeNull();
      expect(booking?.guestPhone).toBeNull();
      expect(booking?.guestLanguage).toBeNull();
      expect(booking?.notes).toBeNull();
      expect(booking?.optedInAt).toBeNull();
      expect(booking?.anonymisedAt).not.toBeNull();

      // Other booking should be unaffected
      const booking2Data = await prisma.booking.findUnique({ where: { id: bookingId2 } });
      expect(booking2Data?.guestName).toBe("Guest Two");

      // Messages should be deleted
      const messages = await prisma.message.findMany({ where: { bookingId } });
      expect(messages).toHaveLength(0);

      // Scheduled messages should be deleted
      const scheduled = await prisma.scheduledMessage.findMany({ where: { bookingId } });
      expect(scheduled).toHaveLength(0);

      // Unmatched message should be deleted
      const unmatched = await prisma.unmatchedMessage.findMany({ where: { ownerId } });
      expect(unmatched).toHaveLength(0);
    });

    it("erases guest data for all bookings with the same phone", async () => {
      const result = await eraseGuestData(ownerId, bookingId, "phone");

      expect(result.bookingsAffected).toBe(2);

      // Both bookings should be anonymised
      const booking1 = await prisma.booking.findUnique({ where: { id: bookingId } });
      expect(booking1?.guestName).toBeNull();

      const booking2 = await prisma.booking.findUnique({ where: { id: bookingId2 } });
      expect(booking2?.guestName).toBeNull();
    });

    it("throws for non-existent booking", async () => {
      await expect(eraseGuestData(ownerId, "non-existent", "booking")).rejects.toThrow("Booking not found");
    });

    it("throws for booking belonging to different owner", async () => {
      const otherOwner = await prisma.owner.create({
        data: { email: "other@example.com", passwordHash: "hash" },
      });

      await expect(eraseGuestData(otherOwner.id, bookingId, "booking")).rejects.toThrow("Booking not found");
    });

    it("creates audit log entry", async () => {
      await eraseGuestData(ownerId, bookingId, "booking");

      const auditLogs = await prisma.auditLog.findMany({
        where: { action: "ERASE_GUEST" },
      });
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].targetId).toBe(bookingId);
    });

    it("handles booking without phone", async () => {
      const bookingNoPhone = await prisma.booking.create({
        data: {
          apartmentId,
          source: "DIRECT",
          status: "CONFIRMED",
          checkIn: new Date("2026-03-01"),
          checkOut: new Date("2026-03-05"),
          guestName: "No Phone Guest",
        },
      });

      const result = await eraseGuestData(ownerId, bookingNoPhone.id, "booking");

      expect(result.bookingsAffected).toBe(1);

      const booking = await prisma.booking.findUnique({ where: { id: bookingNoPhone.id } });
      expect(booking?.guestName).toBeNull();
    });
  });

  describe("collectGuestData", () => {
    it("collects guest data for a booking", async () => {
      const data = await collectGuestData(ownerId, [bookingId]);

      expect(data.bookings).toHaveLength(1);
      expect(data.bookings[0].id).toBe(bookingId);
      expect(data.bookings[0].guestName).toBe("Guest One");
      expect(data.bookings[0].guestPhone).toBe("+35679123456");
      expect(data.bookings[0].messages).toHaveLength(2);
      expect(data.bookings[0].scheduledMessages).toHaveLength(1);
      expect(data.unmatchedMessages).toHaveLength(1);
    });

    it("collects guest data for multiple bookings", async () => {
      const data = await collectGuestData(ownerId, [bookingId, bookingId2]);

      expect(data.bookings).toHaveLength(2);
    });

    it("throws for non-existent bookings", async () => {
      await expect(collectGuestData(ownerId, ["non-existent"])).rejects.toThrow("No bookings found");
    });

    it("throws for bookings belonging to different owner", async () => {
      const otherOwner = await prisma.owner.create({
        data: { email: "other@example.com", passwordHash: "hash" },
      });

      await expect(collectGuestData(otherOwner.id, [bookingId])).rejects.toThrow("No bookings found");
    });

    it("includes all message fields", async () => {
      const data = await collectGuestData(ownerId, [bookingId]);

      const message = data.bookings[0].messages[0];
      expect(message.direction).toBeDefined();
      expect(message.author).toBeDefined();
      expect(message.body).toBeDefined();
      expect(message.language).toBeDefined();
      expect(message.createdAt).toBeDefined();
      expect(message.deliveryStatus).toBeDefined();
    });

    it("includes scheduled message details", async () => {
      const data = await collectGuestData(ownerId, [bookingId]);

      const scheduled = data.bookings[0].scheduledMessages[0];
      expect(scheduled.type).toBe("PRE_ARRIVAL");
      expect(scheduled.sendAt).toBeDefined();
      expect(scheduled.status).toBeDefined();
    });

    it("includes unmatched messages", async () => {
      const data = await collectGuestData(ownerId, [bookingId]);

      expect(data.unmatchedMessages).toHaveLength(1);
      expect(data.unmatchedMessages[0].phone).toBe("+35679123456");
      expect(data.unmatchedMessages[0].body).toBe("Unmatched");
    });
  });
});
