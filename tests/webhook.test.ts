import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/webhooks/twilio-status/route";

// Mock prisma
vi.mock("@/lib/db", () => ({
  prisma: {
    message: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Mock twilio
vi.mock("twilio", () => ({
  default: {
    validateRequest: vi.fn(),
  },
}));

import twilio from "twilio";
import { prisma } from "@/lib/db";

describe("twilio-status webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 for invalid signature", async () => {
    vi.mocked(twilio.validateRequest).mockReturnValue(false);

    const request = new Request("http://localhost/api/webhooks/twilio-status", {
      method: "POST",
      headers: { "x-twilio-signature": "invalid" },
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
  });

  it("returns 200 for valid signature without MessageSid", async () => {
    vi.mocked(twilio.validateRequest).mockReturnValue(true);

    const formData = new FormData();
    const request = new Request("http://localhost/api/webhooks/twilio-status", {
      method: "POST",
      headers: { "x-twilio-signature": "valid" },
      body: formData,
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
  });

  it("returns 200 for unknown MessageSid", async () => {
    vi.mocked(twilio.validateRequest).mockReturnValue(true);
    vi.mocked(prisma.message.findUnique).mockResolvedValue(null);

    const formData = new FormData();
    formData.append("MessageSid", "SM123");
    formData.append("MessageStatus", "delivered");

    const request = new Request("http://localhost/api/webhooks/twilio-status", {
      method: "POST",
      headers: { "x-twilio-signature": "valid" },
      body: formData,
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
  });

  it("updates delivery status for valid message", async () => {
    vi.mocked(twilio.validateRequest).mockReturnValue(true);
    vi.mocked(prisma.message.findUnique).mockResolvedValue({
      id: "msg1",
      bookingId: "booking1",
      twilioSid: "SM123",
      createdAt: new Date(),
      direction: "OUTBOUND",
      body: "Test",
      escalated: false,
      resolved: false,
      deliveryStatus: "queued",
      errorCode: null,
      scheduledMessageId: null,
      author: "SYSTEM",
      language: null,
      hasMedia: false,
      hostSummary: null,
      escalationReason: null,
      urgent: false,
      originalBody: null,
      resolvedAt: null,
      reminderSentAt: null,
    });
    vi.mocked(prisma.message.update).mockResolvedValue({
      id: "msg1",
      bookingId: "booking1",
      twilioSid: "SM123",
      createdAt: new Date(),
      direction: "OUTBOUND",
      body: "Test",
      escalated: false,
      resolved: false,
      deliveryStatus: "delivered",
      errorCode: null,
      scheduledMessageId: null,
      author: "SYSTEM",
      language: null,
      hasMedia: false,
      hostSummary: null,
      escalationReason: null,
      urgent: false,
      originalBody: null,
      resolvedAt: null,
      reminderSentAt: null,
    });

    const formData = new FormData();
    formData.append("MessageSid", "SM123");
    formData.append("MessageStatus", "delivered");

    const request = new Request("http://localhost/api/webhooks/twilio-status", {
      method: "POST",
      headers: { "x-twilio-signature": "valid" },
      body: formData,
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(prisma.message.update).toHaveBeenCalledWith({
      where: { id: "msg1" },
      data: {
        deliveryStatus: "delivered",
        errorCode: null,
      },
    });
  });

  it("does not downgrade status (delivered after sent)", async () => {
    vi.mocked(twilio.validateRequest).mockReturnValue(true);
    vi.mocked(prisma.message.findUnique).mockResolvedValue({
      id: "msg1",
      bookingId: "booking1",
      twilioSid: "SM123",
      createdAt: new Date(),
      direction: "OUTBOUND",
      body: "Test",
      escalated: false,
      resolved: false,
      deliveryStatus: "delivered",
      errorCode: null,
      scheduledMessageId: null,
      author: "SYSTEM",
      language: null,
      hasMedia: false,
      hostSummary: null,
      escalationReason: null,
      urgent: false,
      originalBody: null,
      resolvedAt: null,
      reminderSentAt: null,
    });
      urgent: false,
    });

    const formData = new FormData();
    formData.append("MessageSid", "SM123");
    formData.append("MessageStatus", "sent");

    const request = new Request("http://localhost/api/webhooks/twilio-status", {
      method: "POST",
      headers: { "x-twilio-signature": "valid" },
      body: formData,
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it("stores error code when present", async () => {
    vi.mocked(twilio.validateRequest).mockReturnValue(true);
    vi.mocked(prisma.message.findUnique).mockResolvedValue({
      id: "msg1",
      bookingId: "booking1",
      twilioSid: "SM123",
      createdAt: new Date(),
      direction: "OUTBOUND",
      body: "Test",
      escalated: false,
      resolved: false,
      deliveryStatus: "queued",
      errorCode: null,
      scheduledMessageId: null,
      author: "SYSTEM",
      language: null,
      hasMedia: false,
      hostSummary: null,
      escalationReason: null,
      urgent: false,
    });
    vi.mocked(prisma.message.update).mockResolvedValue({
      id: "msg1",
      bookingId: "booking1",
      twilioSid: "SM123",
      createdAt: new Date(),
      direction: "OUTBOUND",
      body: "Test",
      escalated: false,
      resolved: false,
      deliveryStatus: "failed",
      errorCode: 30001,
      scheduledMessageId: null,
      author: "SYSTEM",
      language: null,
      hasMedia: false,
      hostSummary: null,
      escalationReason: null,
      urgent: false,
    });

    const formData = new FormData();
    formData.append("MessageSid", "SM123");
    formData.append("MessageStatus", "failed");
    formData.append("ErrorCode", "30001");

    const request = new Request("http://localhost/api/webhooks/twilio-status", {
      method: "POST",
      headers: { "x-twilio-signature": "valid" },
      body: formData,
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(prisma.message.update).toHaveBeenCalledWith({
      where: { id: "msg1" },
      data: {
        deliveryStatus: "failed",
        errorCode: 30001,
      },
    });
  });
});
