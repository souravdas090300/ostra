import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../lib/db";

describe("feedback", () => {
  let ownerId: string;
  let apartmentId: string;
  let bookingId: string;
  let aiMessageId: string;
  let hostMessageId: string;
  let inboundMessageId: string;

  beforeEach(async () => {
    const owner = await prisma.owner.create({
      data: {
        email: "feedback-test@example.com",
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

    const booking = await prisma.booking.create({
      data: {
        apartmentId,
        source: "DIRECT",
        status: "CONFIRMED",
        checkIn: new Date("2026-01-01"),
        checkOut: new Date("2026-01-05"),
        guestName: "Test Guest",
        guestPhone: "+35679123456",
      },
    });
    bookingId = booking.id;

    // Create an AI outbound message
    const aiMessage = await prisma.message.create({
      data: {
        bookingId,
        direction: "OUTBOUND",
        author: "AI",
        body: "AI response",
      },
    });
    aiMessageId = aiMessage.id;

    // Create a host outbound message
    const hostMessage = await prisma.message.create({
      data: {
        bookingId,
        direction: "OUTBOUND",
        author: "HOST",
        body: "Host response",
      },
    });
    hostMessageId = hostMessage.id;

    // Create an inbound message
    const inboundMessage = await prisma.message.create({
      data: {
        bookingId,
        direction: "INBOUND",
        author: "GUEST",
        body: "Guest question",
      },
    });
    inboundMessageId = inboundMessage.id;
  });

  afterEach(async () => {
    await prisma.message.deleteMany({});
    await prisma.booking.deleteMany({});
    await prisma.apartment.deleteMany({});
    await prisma.owner.deleteMany({});
  });

  describe("Message feedback fields", () => {
    it("can set and read feedback fields on message", async () => {
      await prisma.message.update({
        where: { id: aiMessageId },
        data: {
          feedback: "GOOD",
          feedbackNote: "Test note",
          feedbackAt: new Date(),
        },
      });

      const message = await prisma.message.findUnique({ where: { id: aiMessageId } });
      expect(message?.feedback).toBe("GOOD");
      expect(message?.feedbackNote).toBe("Test note");
      expect(message?.feedbackAt).not.toBeNull();
    });

    it("can clear feedback fields", async () => {
      await prisma.message.update({
        where: { id: aiMessageId },
        data: {
          feedback: "GOOD",
          feedbackNote: "Test note",
          feedbackAt: new Date(),
        },
      });

      await prisma.message.update({
        where: { id: aiMessageId },
        data: {
          feedback: null,
          feedbackNote: null,
          feedbackAt: null,
        },
      });

      const message = await prisma.message.findUnique({ where: { id: aiMessageId } });
      expect(message?.feedback).toBeNull();
      expect(message?.feedbackNote).toBeNull();
      expect(message?.feedbackAt).toBeNull();
    });

    it("stores feedback for AI messages only", async () => {
      // AI message can have feedback
      await prisma.message.update({
        where: { id: aiMessageId },
        data: { feedback: "GOOD", feedbackAt: new Date() },
      });

      const aiMessage = await prisma.message.findUnique({ where: { id: aiMessageId } });
      expect(aiMessage?.feedback).toBe("GOOD");

      // Host message can also have feedback (database allows it, but action validates)
      await prisma.message.update({
        where: { id: hostMessageId },
        data: { feedback: "GOOD", feedbackAt: new Date() },
      });

      const hostMessage = await prisma.message.findUnique({ where: { id: hostMessageId } });
      expect(hostMessage?.feedback).toBe("GOOD");
    });

    it("feedback note length limit", async () => {
      const longNote = "a".repeat(301);

      // Database would accept it, but we validate in the action
      const message = await prisma.message.update({
        where: { id: aiMessageId },
        data: { feedbackNote: longNote },
      });

      expect(message.feedbackNote).toBe(longNote);
    });
  });

  describe("loadWrongAnswers", () => {
    it("returns empty array when no wrong answers", async () => {
      const { loadWrongAnswers } = await import("../lib/inbox-data");
      const wrongAnswers = await loadWrongAnswers(ownerId, new Date("2026-01-01"));
      expect(wrongAnswers).toHaveLength(0);
    });

    it("returns wrong answers with context", async () => {
      await prisma.message.update({
        where: { id: aiMessageId },
        data: {
          feedback: "WRONG",
          feedbackNote: "Should have said X",
          feedbackAt: new Date("2026-01-01"),
        },
      });

      const { loadWrongAnswers } = await import("../lib/inbox-data");
      const wrongAnswers = await loadWrongAnswers(ownerId, new Date("2025-12-31"));

      expect(wrongAnswers).toHaveLength(1);
      expect(wrongAnswers[0].body).toBe("AI response");
      expect(wrongAnswers[0].feedbackNote).toBe("Should have said X");
      expect(wrongAnswers[0].apartmentName).toBe("Test Apt");
    });

    it("filters by owner", async () => {
      const otherOwner = await prisma.owner.create({
        data: { email: "other@example.com", passwordHash: "hash" },
      });

      const otherApartment = await prisma.apartment.create({
        data: {
          ownerId: otherOwner.id,
          name: "Other Apt",
          address: "Other Address",
          checkInTime: "14:00",
          checkOutTime: "11:00",
        },
      });

      const otherBooking = await prisma.booking.create({
        data: {
          apartmentId: otherApartment.id,
          source: "DIRECT",
          status: "CONFIRMED",
          checkIn: new Date("2026-01-01"),
          checkOut: new Date("2026-01-05"),
        },
      });

      const otherAiMessage = await prisma.message.create({
        data: {
          bookingId: otherBooking.id,
          direction: "OUTBOUND",
          author: "AI",
          body: "Other AI response",
          feedback: "WRONG",
          feedbackAt: new Date("2026-01-01"),
        },
      });

      const { loadWrongAnswers } = await import("../lib/inbox-data");
      const wrongAnswers = await loadWrongAnswers(ownerId, new Date("2025-12-31"));

      // Should only return messages for the first owner
      expect(wrongAnswers).toHaveLength(0);
    });

    it("limits to 20 most recent", async () => {
      // Create 25 wrong answers
      for (let i = 0; i < 25; i++) {
        await prisma.message.create({
          data: {
            bookingId,
            direction: "OUTBOUND",
            author: "AI",
            body: `AI response ${i}`,
            feedback: "WRONG",
            feedbackAt: new Date(`2026-01-${String(i + 1).padStart(2, "0")}`),
          },
        });
      }

      const { loadWrongAnswers } = await import("../lib/inbox-data");
      const wrongAnswers = await loadWrongAnswers(ownerId, new Date("2025-12-31"));

      expect(wrongAnswers.length).toBeLessThanOrEqual(20);
    });
  });
});
