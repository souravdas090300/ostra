import { describe, it, expect, vi, beforeEach } from "vitest";
import { rescheduleBookings, ensureDefaultTemplates } from "@/lib/schedule";

// Mock prisma
vi.mock("@/lib/db", () => ({
  prisma: {
    booking: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    messageTemplate: {
      upsert: vi.fn(),
    },
    templateTranslation: {
      upsert: vi.fn(),
    },
    scheduledMessage: {
      updateMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";

describe("schedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("ensureDefaultTemplates", () => {
    it("creates default templates for owner", async () => {
      vi.mocked(prisma.messageTemplate.upsert).mockResolvedValue({
        id: "template1",
        type: "PRE_ARRIVAL",
        body: "Default body",
        ownerId: "owner1",
        enabled: true,
        updatedAt: new Date(),
      } as any);
      vi.mocked(prisma.templateTranslation.upsert).mockResolvedValue({
        id: "trans1",
        templateId: "template1",
        language: "en",
        body: "Default body",
        sourceHash: "abc123",
        editedByHost: false,
        approval: "NONE",
        metaTemplateName: null,
        rejectionReason: null,
        updatedAt: new Date(),
      });

      await ensureDefaultTemplates("owner1", "en");

      expect(prisma.messageTemplate.upsert).toHaveBeenCalledTimes(4); // 4 message types
      expect(prisma.templateTranslation.upsert).toHaveBeenCalledTimes(4);
    });
  });

  describe("rescheduleBookings", () => {
    it("does nothing for empty booking list", async () => {
      await rescheduleBookings([]);
      expect(prisma.booking.findMany).not.toHaveBeenCalled();
    });

    it("creates templates if missing", async () => {
      vi.mocked(prisma.booking.findMany).mockResolvedValue([
        {
          id: "booking1",
          apartmentId: "apt1",
          apartment: {
            ownerId: "owner1",
            owner: {
              id: "owner1",
              hostLanguage: "en",
              templates: [], // No templates
            },
          },
        } as any,
      ]);
      vi.mocked(prisma.booking.findUnique).mockResolvedValue({
        id: "booking1",
        apartmentId: "apt1",
        apartment: {
          ownerId: "owner1",
          owner: {
            id: "owner1",
            hostLanguage: "en",
            templates: [],
          },
        },
        scheduled: [],
      } as any);
      vi.mocked(prisma.messageTemplate.upsert).mockResolvedValue({
        id: "template1",
        type: "PRE_ARRIVAL",
        body: "Default",
        ownerId: "owner1",
        enabled: true,
        updatedAt: new Date(),
      } as any);
      vi.mocked(prisma.templateTranslation.upsert).mockResolvedValue({
        id: "trans1",
        templateId: "template1",
        language: "en",
        body: "Default",
        sourceHash: "abc123",
        editedByHost: false,
        approval: "NONE",
        metaTemplateName: null,
        rejectionReason: null,
        updatedAt: new Date(),
      });

      await rescheduleBookings(["booking1"]);

      expect(prisma.messageTemplate.upsert).toHaveBeenCalled();
    });

    it("cancels pending messages for ineligible booking", async () => {
      vi.mocked(prisma.booking.findMany).mockResolvedValue([
        {
          id: "booking1",
          apartmentId: "apt1",
          apartment: {
            ownerId: "owner1",
            owner: {
              id: "owner1",
              hostLanguage: "en",
              templates: [],
            },
          },
        } as any,
      ]);
      vi.mocked(prisma.booking.findUnique).mockResolvedValue({
        id: "booking1",
        apartmentId: "apt1",
        apartment: {
          ownerId: "owner1",
          owner: {
            id: "owner1",
            hostLanguage: "en",
            templates: [],
          },
        },
        isBlock: true, // Ineligible: block
        status: "CONFIRMED",
        guestPhone: "+35679123456",
        optedInAt: new Date(),
        optedOutAt: null,
        messagesPaused: false,
        scheduled: [],
      } as any);
      vi.mocked(prisma.scheduledMessage.updateMany).mockResolvedValue({ count: 0 });

      await rescheduleBookings(["booking1"]);

      expect(prisma.scheduledMessage.updateMany).toHaveBeenCalledWith({
        where: {
          bookingId: "booking1",
          status: { in: ["PENDING", "SKIPPED"] },
          hostSkipped: false,
        },
        data: {
          status: "CANCELLED",
          skipReason: "Booking not eligible for messages",
        },
      });
    });
  });
});
