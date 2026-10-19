import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendDueMessages } from "@/lib/send-scheduled";

// Mock dependencies
vi.mock("@/lib/db", () => ({
  prisma: {
    scheduledMessage: {
      updateMany: vi.fn(),
      $queryRaw: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    message: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/message-render", () => ({
  buildValues: vi.fn(),
  pickTranslation: vi.fn(),
  renderText: vi.fn(),
}));

vi.mock("@/lib/send-time", () => ({
  inAllowedWindow: vi.fn(),
  latestUseful: vi.fn(),
}));

vi.mock("@/lib/templates", () => ({
  toTwilioBody: vi.fn(),
}));

vi.mock("@/lib/whatsapp", () => ({
  sendWhatsApp: vi.fn(),
  whatsappMode: vi.fn(),
  WhatsAppError: class extends Error {
    constructor(message: string, public permanent: boolean, public code?: number) {
      super(message);
    }
  },
}));

import { prisma } from "@/lib/db";
import { buildValues, pickTranslation, renderText } from "@/lib/message-render";
import { inAllowedWindow, latestUseful } from "@/lib/send-time";
import { toTwilioBody } from "@/lib/templates";
import { sendWhatsApp, whatsappMode, WhatsAppError } from "@/lib/whatsapp";

describe("send-scheduled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing outside allowed window", async () => {
    vi.mocked(inAllowedWindow).mockReturnValue(false);

    const summary = await sendDueMessages();

    expect(summary).toEqual({ claimed: 0, sent: 0, skipped: 0, failed: 0, retried: 0 });
    expect(prisma.scheduledMessage.updateMany).not.toHaveBeenCalled();
  });

  it("marks stuck SENDING messages as FAILED", async () => {
    vi.mocked(inAllowedWindow).mockReturnValue(true);
    vi.mocked(prisma.scheduledMessage.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);

    await sendDueMessages();

    expect(prisma.scheduledMessage.updateMany).toHaveBeenCalledWith({
      where: {
        status: "SENDING",
        claimedAt: { lt: expect.any(Date) },
      },
      data: {
        status: "FAILED",
        lastError: "Unclear whether this was sent. Check before resending.",
      },
    });
  });

  it("claims pending messages atomically", async () => {
    vi.mocked(inAllowedWindow).mockReturnValue(true);
    vi.mocked(prisma.scheduledMessage.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "msg1" }]);
    vi.mocked(prisma.scheduledMessage.findUniqueOrThrow).mockResolvedValue({
      id: "msg1",
      bookingId: "booking1",
      type: "PRE_ARRIVAL",
      sendAt: new Date(),
      status: "SENDING",
      attempts: 1,
      claimedAt: new Date(),
      sentAt: null,
      lastError: null,
      skipReason: null,
      hostSkipped: false,
      twilioSid: null,
      language: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      booking: {
        id: "booking1",
        apartmentId: "apt1",
        isBlock: false,
        status: "CONFIRMED",
        guestPhone: "+35679123456",
        optedInAt: new Date(),
        optedOutAt: null,
        messagesPaused: false,
        checkIn: new Date(),
        checkOut: new Date(),
        guestName: "Anna",
        apartment: {
          id: "apt1",
          name: "Seaview",
          checkInTime: "14:00",
          checkOutTime: "11:00",
          reviewUrl: null,
          owner: {
            id: "owner1",
            fallbackLanguage: "en",
            defaultGuestLanguage: "en",
            templates: [
              {
                id: "template1",
                type: "PRE_ARRIVAL",
                enabled: true,
                translations: [
                  {
                    id: "trans1",
                    language: "en",
                    body: "Hello {{guestName}}",
                    approval: "APPROVED",
                    contentSid: "HX123",
                    sourceHash: "abc",
                    editedByHost: false,
                    rejectionReason: null,
                    updatedAt: new Date(),
                  },
                ],
              },
            ],
          },
        },
      },
    } as any);
    vi.mocked(pickTranslation).mockReturnValue({
      translation: {
        language: "en",
        body: "Hello {{guestName}}",
        approval: "APPROVED",
        contentSid: "HX123",
      },
      usedFallback: false,
    });
    vi.mocked(buildValues).mockReturnValue({
      guestName: "Anna",
      apartmentName: "Seaview",
    });
    vi.mocked(renderText).mockReturnValue("Hello Anna");
    vi.mocked(toTwilioBody).mockReturnValue({
      body: "Hello {{1}}",
      order: ["guestName"],
    });
    vi.mocked(whatsappMode).mockReturnValue("production");
    vi.mocked(sendWhatsApp).mockResolvedValue({ sid: "SM123" });
    vi.mocked(prisma.$transaction).mockResolvedValue([{}, {}]);
    vi.mocked(prisma.scheduledMessage.update).mockResolvedValue({
      id: "msg1",
      bookingId: "booking1",
      type: "PRE_ARRIVAL",
      sendAt: new Date(),
      status: "SENT",
      attempts: 1,
      claimedAt: new Date(),
      sentAt: new Date(),
      lastError: null,
      skipReason: null,
      hostSkipped: false,
      twilioSid: "SM123",
      language: "en",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const summary = await sendDueMessages();

    expect(summary.claimed).toBe(1);
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it("skips when booking became ineligible", async () => {
    vi.mocked(inAllowedWindow).mockReturnValue(true);
    vi.mocked(prisma.scheduledMessage.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "msg1" }]);
    vi.mocked(prisma.scheduledMessage.findUniqueOrThrow).mockResolvedValue({
      id: "msg1",
      bookingId: "booking1",
      type: "PRE_ARRIVAL",
      sendAt: new Date(),
      status: "SENDING",
      attempts: 1,
      claimedAt: new Date(),
      sentAt: null,
      lastError: null,
      skipReason: null,
      hostSkipped: false,
      twilioSid: null,
      language: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      booking: {
        id: "booking1",
        apartmentId: "apt1",
        isBlock: false,
        status: "CANCELLED", // Ineligible
        guestPhone: "+35679123456",
        optedInAt: new Date(),
        optedOutAt: null,
        messagesPaused: false,
        checkIn: new Date(),
        checkOut: new Date(),
        guestName: "Anna",
        apartment: {
          id: "apt1",
          name: "Seaview",
          checkInTime: "14:00",
          checkOutTime: "11:00",
          reviewUrl: null,
          owner: {
            id: "owner1",
            fallbackLanguage: "en",
            defaultGuestLanguage: "en",
            templates: [],
          },
        },
      },
    } as any);
    vi.mocked(prisma.scheduledMessage.update).mockResolvedValue({
      id: "msg1",
      bookingId: "booking1",
      type: "PRE_ARRIVAL",
      sendAt: new Date(),
      status: "PENDING",
      attempts: 0,
      claimedAt: null,
      sentAt: null,
      lastError: null,
      skipReason: null,
      hostSkipped: false,
      twilioSid: null,
      language: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const summary = await sendDueMessages();

    expect(summary.skipped).toBe(1);
    expect(prisma.scheduledMessage.update).toHaveBeenCalledWith({
      where: { id: "msg1" },
      data: {
        status: "CANCELLED",
        skipReason: "Booking not eligible for messages",
      },
    });
  });

  it("skips when past latest useful moment", async () => {
    vi.mocked(inAllowedWindow).mockReturnValue(true);
    vi.mocked(prisma.scheduledMessage.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "msg1" }]);
    vi.mocked(prisma.scheduledMessage.findUniqueOrThrow).mockResolvedValue({
      id: "msg1",
      bookingId: "booking1",
      type: "PRE_ARRIVAL",
      sendAt: new Date(),
      status: "SENDING",
      attempts: 1,
      claimedAt: new Date(),
      sentAt: null,
      lastError: null,
      skipReason: null,
      hostSkipped: false,
      twilioSid: null,
      language: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      booking: {
        id: "booking1",
        apartmentId: "apt1",
        isBlock: false,
        status: "CONFIRMED",
        guestPhone: "+35679123456",
        optedInAt: new Date(),
        optedOutAt: null,
        messagesPaused: false,
        checkIn: new Date(),
        checkOut: new Date(),
        guestName: "Anna",
        apartment: {
          id: "apt1",
          name: "Seaview",
          checkInTime: "14:00",
          checkOutTime: "11:00",
          reviewUrl: null,
          owner: {
            id: "owner1",
            fallbackLanguage: "en",
            defaultGuestLanguage: "en",
            templates: [],
          },
        },
      },
    } as any);
    vi.mocked(latestUseful).mockReturnValue(new Date("2026-01-01")); // Past
    vi.mocked(prisma.scheduledMessage.update).mockResolvedValue({
      id: "msg1",
      bookingId: "booking1",
      type: "PRE_ARRIVAL",
      sendAt: new Date(),
      status: "SKIPPED",
      attempts: 1,
      claimedAt: new Date(),
      sentAt: null,
      lastError: null,
      skipReason: "Too late to send this message.",
      hostSkipped: false,
      twilioSid: null,
      language: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const summary = await sendDueMessages();

    expect(summary.skipped).toBe(1);
    expect(prisma.scheduledMessage.update).toHaveBeenCalledWith({
      where: { id: "msg1" },
      data: {
        status: "SKIPPED",
        skipReason: "Too late to send this message.",
      },
    });
  });

  it("respects daily cap", async () => {
    vi.mocked(inAllowedWindow).mockReturnValue(true);
    vi.mocked(prisma.scheduledMessage.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "msg1" }]);
    vi.mocked(prisma.scheduledMessage.findUniqueOrThrow).mockResolvedValue({
      id: "msg1",
      bookingId: "booking1",
      type: "PRE_ARRIVAL",
      sendAt: new Date(),
      status: "SENDING",
      attempts: 1,
      claimedAt: new Date(),
      sentAt: null,
      lastError: null,
      skipReason: null,
      hostSkipped: false,
      twilioSid: null,
      language: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      booking: {
        id: "booking1",
        apartmentId: "apt1",
        isBlock: false,
        status: "CONFIRMED",
        guestPhone: "+35679123456",
        optedInAt: new Date(),
        optedOutAt: null,
        messagesPaused: false,
        checkIn: new Date(),
        checkOut: new Date(),
        guestName: "Anna",
        apartment: {
          id: "apt1",
          name: "Seaview",
          checkInTime: "14:00",
          checkOutTime: "11:00",
          reviewUrl: null,
          owner: {
            id: "owner1",
            fallbackLanguage: "en",
            defaultGuestLanguage: "en",
            templates: [],
          },
        },
      },
    } as any);
    vi.mocked(prisma.scheduledMessage.count).mockResolvedValue(100); // At cap
    vi.mocked(prisma.scheduledMessage.update).mockResolvedValue({
      id: "msg1",
      bookingId: "booking1",
      type: "PRE_ARRIVAL",
      sendAt: new Date(),
      status: "PENDING",
      attempts: 0,
      claimedAt: null,
      sentAt: null,
      lastError: null,
      skipReason: null,
      hostSkipped: false,
      twilioSid: null,
      language: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const summary = await sendDueMessages();

    expect(prisma.scheduledMessage.update).toHaveBeenCalledWith({
      where: { id: "msg1" },
      data: {
        status: "PENDING",
        attempts: { decrement: 1 },
        claimedAt: null,
      },
    });
  });

  it("retries transient errors", async () => {
    vi.mocked(inAllowedWindow).mockReturnValue(true);
    vi.mocked(prisma.scheduledMessage.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "msg1" }]);
    vi.mocked(prisma.scheduledMessage.findUniqueOrThrow).mockResolvedValue({
      id: "msg1",
      bookingId: "booking1",
      type: "PRE_ARRIVAL",
      sendAt: new Date(),
      status: "SENDING",
      attempts: 1,
      claimedAt: new Date(),
      sentAt: null,
      lastError: null,
      skipReason: null,
      hostSkipped: false,
      twilioSid: null,
      language: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      booking: {
        id: "booking1",
        apartmentId: "apt1",
        isBlock: false,
        status: "CONFIRMED",
        guestPhone: "+35679123456",
        optedInAt: new Date(),
        optedOutAt: null,
        messagesPaused: false,
        checkIn: new Date(),
        checkOut: new Date(),
        guestName: "Anna",
        apartment: {
          id: "apt1",
          name: "Seaview",
          checkInTime: "14:00",
          checkOutTime: "11:00",
          reviewUrl: null,
          owner: {
            id: "owner1",
            fallbackLanguage: "en",
            defaultGuestLanguage: "en",
            templates: [],
          },
        },
      },
    } as any);
    vi.mocked(pickTranslation).mockReturnValue({
      translation: {
        language: "en",
        body: "Hello {{guestName}}",
        approval: "APPROVED",
        contentSid: "HX123",
      },
      usedFallback: false,
    });
    vi.mocked(buildValues).mockReturnValue({ guestName: "Anna" });
    vi.mocked(renderText).mockReturnValue("Hello Anna");
    vi.mocked(toTwilioBody).mockReturnValue({
      body: "Hello {{1}}",
      order: ["guestName"],
    });
    vi.mocked(whatsappMode).mockReturnValue("production");
    vi.mocked(sendWhatsApp).mockRejectedValue(
      new WhatsAppError("Temporary error", false, 429)
    );
    vi.mocked(prisma.scheduledMessage.update).mockResolvedValue({
      id: "msg1",
      bookingId: "booking1",
      type: "PRE_ARRIVAL",
      sendAt: new Date(),
      status: "PENDING",
      attempts: 0,
      claimedAt: null,
      sentAt: null,
      lastError: "Temporary problem sending",
      skipReason: null,
      hostSkipped: false,
      twilioSid: null,
      language: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const summary = await sendDueMessages();

    expect(summary.retried).toBe(1);
    expect(prisma.scheduledMessage.update).toHaveBeenCalledWith({
      where: { id: "msg1" },
      data: {
        status: "PENDING",
        lastError: expect.stringContaining("Temporary"),
        claimedAt: null,
        sendAt: expect.any(Date),
      },
    });
  });

  it("fails permanently for permanent errors", async () => {
    vi.mocked(inAllowedWindow).mockReturnValue(true);
    vi.mocked(prisma.scheduledMessage.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "msg1" }]);
    vi.mocked(prisma.scheduledMessage.findUniqueOrThrow).mockResolvedValue({
      id: "msg1",
      bookingId: "booking1",
      type: "PRE_ARRIVAL",
      sendAt: new Date(),
      status: "SENDING",
      attempts: 1,
      claimedAt: new Date(),
      sentAt: null,
      lastError: null,
      skipReason: null,
      hostSkipped: false,
      twilioSid: null,
      language: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      booking: {
        id: "booking1",
        apartmentId: "apt1",
        isBlock: false,
        status: "CONFIRMED",
        guestPhone: "+35679123456",
        optedInAt: new Date(),
        optedOutAt: null,
        messagesPaused: false,
        checkIn: new Date(),
        checkOut: new Date(),
        guestName: "Anna",
        apartment: {
          id: "apt1",
          name: "Seaview",
          checkInTime: "14:00",
          checkOutTime: "11:00",
          reviewUrl: null,
          owner: {
            id: "owner1",
            fallbackLanguage: "en",
            defaultGuestLanguage: "en",
            templates: [],
          },
        },
      },
    } as any);
    vi.mocked(pickTranslation).mockReturnValue({
      translation: {
        language: "en",
        body: "Hello {{guestName}}",
        approval: "APPROVED",
        contentSid: "HX123",
      },
      usedFallback: false,
    });
    vi.mocked(buildValues).mockReturnValue({ guestName: "Anna" });
    vi.mocked(renderText).mockReturnValue("Hello Anna");
    vi.mocked(toTwilioBody).mockReturnValue({
      body: "Hello {{1}}",
      order: ["guestName"],
    });
    vi.mocked(whatsappMode).mockReturnValue("production");
    vi.mocked(sendWhatsApp).mockRejectedValue(
      new WhatsAppError("Permanent error", true, 400)
    );
    vi.mocked(prisma.scheduledMessage.update).mockResolvedValue({
      id: "msg1",
      bookingId: "booking1",
      type: "PRE_ARRIVAL",
      sendAt: new Date(),
      status: "FAILED",
      attempts: 1,
      claimedAt: null,
      sentAt: null,
      lastError: "WhatsApp rejected the message",
      skipReason: null,
      hostSkipped: false,
      twilioSid: null,
      language: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const summary = await sendDueMessages();

    expect(summary.failed).toBe(1);
    expect(prisma.scheduledMessage.update).toHaveBeenCalledWith({
      where: { id: "msg1" },
      data: {
        status: "FAILED",
        lastError: expect.stringContaining("rejected"),
        claimedAt: null,
      },
    });
  });
});
