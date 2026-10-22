import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../lib/db";
import { runRetention } from "../lib/retention";

describe("retention", () => {
  let ownerId: string;
  let apartmentId: string;
  let bookingId: string;

  beforeEach(async () => {
    const owner = await prisma.owner.create({
      data: {
        email: "retention-test@example.com",
        passwordHash: "hash",
        retentionDays: 90,
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
        guestLanguage: "en",
        notes: "Test notes",
        optedInAt: new Date(),
      },
    });
    bookingId = booking.id;

    // Add messages
    await prisma.message.createMany({
      data: [
        {
          bookingId,
          direction: "INBOUND",
          author: "GUEST",
          body: "Test message",
        },
        {
          bookingId,
          direction: "OUTBOUND",
          author: "AI",
          body: "Test reply",
        },
      ],
    });

    // Add scheduled message
    await prisma.scheduledMessage.create({
      data: {
        bookingId,
        type: "PRE_ARRIVAL",
        sendAt: new Date("2026-01-01"),
        status: "PENDING",
      },
    });
  });

  afterEach(async () => {
    await prisma.message.deleteMany({});
    await prisma.scheduledMessage.deleteMany({});
    await prisma.booking.deleteMany({});
    await prisma.apartment.deleteMany({});
    await prisma.owner.deleteMany({});
    await prisma.loginAttempt.deleteMany({});
    await prisma.unmatchedMessage.deleteMany({});
    await prisma.jobRun.deleteMany({});
    await prisma.auditLog.deleteMany({});
  });

  it("dry-run counts bookings without deleting", async () => {
    const now = new Date("2026-10-01"); // 9 months after check-out
    const result = await runRetention(now, true);

    expect(result.bookings).toBeGreaterThan(0);
    expect(result.messages).toBe(0);
    expect(result.scheduled).toBe(0);

    // Verify data still exists
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    expect(booking?.guestName).toBe("Test Guest");

    const messages = await prisma.message.findMany({ where: { bookingId } });
    expect(messages).toHaveLength(2);
  });

  it("deletes guest data past retention period", async () => {
    const now = new Date("2026-10-01"); // 9 months after check-out
    const result = await runRetention(now, false);

    expect(result.bookings).toBeGreaterThan(0);
    expect(result.messages).toBeGreaterThan(0);
    expect(result.scheduled).toBeGreaterThan(0);

    // Verify guest data is anonymised
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    expect(booking?.guestName).toBeNull();
    expect(booking?.guestPhone).toBeNull();
    expect(booking?.guestLanguage).toBeNull();
    expect(booking?.notes).toBeNull();
    expect(booking?.optedInAt).toBeNull();
    expect(booking?.anonymisedAt).not.toBeNull();

    // Verify messages are deleted
    const messages = await prisma.message.findMany({ where: { bookingId } });
    expect(messages).toHaveLength(0);

    // Verify scheduled messages are deleted
    const scheduled = await prisma.scheduledMessage.findMany({ where: { bookingId } });
    expect(scheduled).toHaveLength(0);
  });

  it("keeps recent guest data", async () => {
    const now = new Date("2026-01-10"); // Only 5 days after check-out
    const result = await runRetention(now, false);

    expect(result.bookings).toBe(0);

    // Verify data still exists
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    expect(booking?.guestName).toBe("Test Guest");
  });

  it("respects custom retention days", async () => {
    await prisma.owner.update({
      where: { id: ownerId },
      data: { retentionDays: 30 },
    });

    const now = new Date("2026-02-01"); // 27 days after check-out
    const result = await runRetention(now, false);

    expect(result.bookings).toBe(0);

    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    expect(booking?.guestName).toBe("Test Guest");
  });

  it("enforces minimum retention of 30 days", async () => {
    await prisma.owner.update({
      where: { id: ownerId },
      data: { retentionDays: 10 }, // Below minimum
    });

    const now = new Date("2026-02-01"); // 27 days after check-out
    const result = await runRetention(now, false);

    expect(result.bookings).toBe(0); // Should still be kept (min 30 days)
  });

  it("enforces maximum retention of 730 days", async () => {
    await prisma.owner.update({
      where: { id: ownerId },
      data: { retentionDays: 1000 }, // Above maximum
    });

    const now = new Date("2028-02-01"); // More than 2 years after check-out (2026-01-05)
    const result = await runRetention(now, false);

    expect(result.bookings).toBeGreaterThan(0); // Should be deleted (max 730 days)

    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    expect(booking?.guestName).toBeNull();
  });

  it("skips blocked dates", async () => {
    await prisma.booking.update({
      where: { id: bookingId },
      data: { isBlock: true },
    });

    const now = new Date("2026-10-01");
    const result = await runRetention(now, false);

    expect(result.bookings).toBe(0); // Blocked dates should be skipped

    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    expect(booking?.guestName).toBe("Test Guest"); // Guest data should remain for blocked dates
  });

  it("does not re-anonymise already anonymised bookings", async () => {
    await prisma.booking.update({
      where: { id: bookingId },
      data: { anonymisedAt: new Date("2026-01-06") },
    });

    const now = new Date("2026-10-01");
    const result = await runRetention(now, false);

    expect(result.bookings).toBe(0); // Should not count already anonymised
  });

  it("deletes old login attempts", async () => {
    await prisma.loginAttempt.create({
      data: {
        emailHash: "hash1",
        ipHash: "hash2",
        success: false,
        createdAt: new Date("2026-01-01"),
      },
    });

    const now = new Date("2026-10-01");
    const result = await runRetention(now, false);

    expect(result.attempts).toBeGreaterThan(0);

    const attempts = await prisma.loginAttempt.findMany();
    expect(attempts).toHaveLength(0);
  });

  it("deletes old unmatched messages", async () => {
    await prisma.unmatchedMessage.create({
      data: {
        ownerId,
        phone: "+35679123456",
        body: "Test",
        twilioSid: "sid123",
        receivedAt: new Date("2026-01-01"),
      },
    });

    const now = new Date("2026-10-01");
    const result = await runRetention(now, false);

    expect(result.unmatched).toBeGreaterThan(0);

    const unmatched = await prisma.unmatchedMessage.findMany();
    expect(unmatched).toHaveLength(0);
  });

  it("creates audit log entry", async () => {
    const now = new Date("2026-10-01");
    await runRetention(now, false);

    const auditLogs = await prisma.auditLog.findMany({
      where: { action: "RETENTION_RUN" },
    });
    expect(auditLogs).toHaveLength(1);
  });
});
