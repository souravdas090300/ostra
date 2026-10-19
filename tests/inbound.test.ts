import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../lib/db";
import { processInbound } from "../lib/inbound";
import { sendWhatsApp } from "../lib/whatsapp";
import { answerGuest } from "../lib/assistant";
import { notifyHost } from "../lib/notify";

// Mock external dependencies
vi.mock("../lib/whatsapp");
vi.mock("../lib/assistant");
vi.mock("../lib/notify");

describe("processInbound", () => {
  beforeEach(async () => {
    // Clean up test data
    await prisma.message.deleteMany({});
    await prisma.unmatchedMessage.deleteMany({});
    await prisma.booking.deleteMany({});
    await prisma.apartment.deleteMany({});
    await prisma.owner.deleteMany({});
  });

  afterEach(async () => {
    // Clean up test data
    await prisma.message.deleteMany({});
    await prisma.unmatchedMessage.deleteMany({});
    await prisma.booking.deleteMany({});
    await prisma.apartment.deleteMany({});
    await prisma.owner.deleteMany({});
  });

  it("stores inbound message for matched booking", async () => {
    const owner = await prisma.owner.create({
      data: {
        email: "test@example.com",
        passwordHash: "hash",
        whatsappFrom: "+35679123456",
      },
    });

    const apartment = await prisma.apartment.create({
      data: {
        ownerId: owner.id,
        name: "Test Apt",
        address: "123 St",
        checkInTime: "14:00",
        checkOutTime: "11:00",
      },
    });

    const now = new Date();
    const booking = await prisma.booking.create({
      data: {
        apartmentId: apartment.id,
        source: "DIRECT",
        status: "CONFIRMED",
        checkIn: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        checkOut: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        guestPhone: "+4915112345678",
        guestName: "Test Guest",
      },
    });

    vi.mocked(sendWhatsApp).mockResolvedValue({ sid: "SM123" });
    vi.mocked(answerGuest).mockResolvedValue({
      language: "en",
      reply: "Test reply",
      escalate: false,
      urgent: false,
      reason: "",
      hostSummary: "",
      optOut: false,
    });

    await processInbound({
      sid: "SMtest",
      from: "whatsapp:+4915112345678",
      to: "whatsapp:+35679123456",
      body: "Hello",
      numMedia: 0,
    });

    const messages = await prisma.message.findMany({ where: { bookingId: booking.id } });
    expect(messages.length).toBeGreaterThanOrEqual(1);
    const inbound = messages.find((m) => m.direction === "INBOUND");
    expect(inbound).toBeDefined();
    expect(inbound?.author).toBe("GUEST");
    expect(inbound?.body).toBe("Hello");
  });

  it("is idempotent on MessageSid", async () => {
    const owner = await prisma.owner.create({
      data: {
        email: "test@example.com",
        passwordHash: "hash",
        whatsappFrom: "+35679123456",
      },
    });

    const apartment = await prisma.apartment.create({
      data: {
        ownerId: owner.id,
        name: "Test Apt",
        address: "123 St",
        checkInTime: "14:00",
        checkOutTime: "11:00",
      },
    });

    const now = new Date();
    const booking = await prisma.booking.create({
      data: {
        apartmentId: apartment.id,
        source: "DIRECT",
        status: "CONFIRMED",
        checkIn: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        checkOut: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        guestPhone: "+4915112345678",
        guestName: "Test Guest",
      },
    });

    vi.mocked(sendWhatsApp).mockResolvedValue({ sid: "SM123" });
    vi.mocked(answerGuest).mockResolvedValue({
      language: "en",
      reply: "Test reply",
      escalate: false,
      urgent: false,
      reason: "",
      hostSummary: "",
      optOut: false,
    });

    await processInbound({
      sid: "SMtest",
      from: "whatsapp:+4915112345678",
      to: "whatsapp:+35679123456",
      body: "Hello",
      numMedia: 0,
    });

    await processInbound({
      sid: "SMtest",
      from: "whatsapp:+4915112345678",
      to: "whatsapp:+35679123456",
      body: "Hello",
      numMedia: 0,
    });

    const messages = await prisma.message.findMany({ where: { bookingId: booking.id } });
    const inbound = messages.filter((m) => m.direction === "INBOUND");
    expect(inbound.length).toBe(1);
  });

  it("stores unmatched message for unknown number", async () => {
    const owner = await prisma.owner.create({
      data: {
        email: "test@example.com",
        passwordHash: "hash",
        whatsappFrom: "+35679123456",
      },
    });

    await processInbound({
      sid: "SMtest",
      from: "whatsapp:+4915112345678",
      to: "whatsapp:+35679123456",
      body: "Hello",
      numMedia: 0,
    });

    const unmatched = await prisma.unmatchedMessage.findUnique({ where: { twilioSid: "SMtest" } });
    expect(unmatched).toBeDefined();
    expect(unmatched?.phone).toBe("+4915112345678");
  });

  it("escalates when answerGuest returns escalate=true", async () => {
    const owner = await prisma.owner.create({
      data: {
        email: "test@example.com",
        passwordHash: "hash",
        whatsappFrom: "+35679123456",
      },
    });

    const apartment = await prisma.apartment.create({
      data: {
        ownerId: owner.id,
        name: "Test Apt",
        address: "123 St",
        checkInTime: "14:00",
        checkOutTime: "11:00",
      },
    });

    const now = new Date();
    const booking = await prisma.booking.create({
      data: {
        apartmentId: apartment.id,
        source: "DIRECT",
        status: "CONFIRMED",
        checkIn: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        checkOut: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        guestPhone: "+4915112345678",
        guestName: "Test Guest",
      },
    });

    vi.mocked(sendWhatsApp).mockResolvedValue({ sid: "SM123" });
    vi.mocked(answerGuest).mockResolvedValue({
      language: "en",
      reply: "I'll check with the host",
      escalate: true,
      urgent: false,
      reason: "Guest asked about money",
      hostSummary: "Guest wants a refund",
      optOut: false,
    });

    await processInbound({
      sid: "SMtest",
      from: "whatsapp:+4915112345678",
      to: "whatsapp:+35679123456",
      body: "I want a refund",
      numMedia: 0,
    });

    const messages = await prisma.message.findMany({ where: { bookingId: booking.id } });
    const inbound = messages.find((m) => m.direction === "INBOUND");
    expect(inbound?.escalated).toBe(true);
    expect(inbound?.hostSummary).toBe("Guest wants a refund");
    expect(inbound?.escalationReason).toBe("Guest asked about money");
  });

  it("sends notification on escalation", async () => {
    const owner = await prisma.owner.create({
      data: {
        email: "test@example.com",
        passwordHash: "hash",
        whatsappFrom: "+35679123456",
      },
    });

    const apartment = await prisma.apartment.create({
      data: {
        ownerId: owner.id,
        name: "Test Apt",
        address: "123 St",
        checkInTime: "14:00",
        checkOutTime: "11:00",
      },
    });

    const now = new Date();
    const booking = await prisma.booking.create({
      data: {
        apartmentId: apartment.id,
        source: "DIRECT",
        status: "CONFIRMED",
        checkIn: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        checkOut: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        guestPhone: "+4915112345678",
        guestName: "Test Guest",
      },
    });

    vi.mocked(sendWhatsApp).mockResolvedValue({ sid: "SM123" });
    vi.mocked(answerGuest).mockResolvedValue({
      language: "en",
      reply: "I'll check with the host",
      escalate: true,
      urgent: false,
      reason: "Test",
      hostSummary: "Test summary",
      optOut: false,
    });

    await processInbound({
      sid: "SMtest",
      from: "whatsapp:+4915112345678",
      to: "whatsapp:+35679123456",
      body: "Test",
      numMedia: 0,
    });

    expect(notifyHost).toHaveBeenCalled();
  });
});
