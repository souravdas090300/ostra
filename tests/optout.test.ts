import { describe, it, expect, vi, beforeEach } from "vitest";
import { optOutPhone, phoneIsOptedOut } from "@/lib/optout";

// Mock prisma
vi.mock("@/lib/db", () => ({
  prisma: {
    booking: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    optOut: {
      upsert: vi.fn(),
      count: vi.fn(),
    },
    scheduledMessage: {
      updateMany: vi.fn(),
    },
  },
}));

// Mock schedule
vi.mock("@/lib/schedule", () => ({
  rescheduleBookings: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { rescheduleBookings } from "@/lib/schedule";

describe("optout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("optOutPhone", () => {
    it("opts out phone across all bookings for owner", async () => {
      const mockBookings = [
        { id: "booking1", status: "CONFIRMED", createdAt: new Date(), updatedAt: new Date(), apartmentId: "apt1", externalUid: null, source: "DIRECT", checkIn: new Date(), checkOut: new Date(), guestName: null, guestPhone: null, guestLanguage: null, guests: null, notes: null, isBlock: false, messagesPaused: false, optedInAt: null, optedOutAt: null, anonymisedAt: null, calendarFeedId: null },
        { id: "booking2", status: "CONFIRMED", createdAt: new Date(), updatedAt: new Date(), apartmentId: "apt1", externalUid: null, source: "DIRECT", checkIn: new Date(), checkOut: new Date(), guestName: null, guestPhone: null, guestLanguage: null, guests: null, notes: null, isBlock: false, messagesPaused: false, optedInAt: null, optedOutAt: null, anonymisedAt: null, calendarFeedId: null },
      ];
      vi.mocked(prisma.booking.findMany).mockResolvedValue(mockBookings);
      vi.mocked(prisma.booking.updateMany).mockResolvedValue({ count: 2 });
      vi.mocked(rescheduleBookings).mockResolvedValue(undefined);

      await optOutPhone("owner1", "+35679123456");

      expect(prisma.booking.findMany).toHaveBeenCalledWith({
        where: {
          guestPhone: "+35679123456",
          apartment: { ownerId: "owner1" },
        },
        select: { id: true },
      });
      expect(prisma.booking.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["booking1", "booking2"] } },
        data: { optedOutAt: expect.any(Date) },
      });
      expect(rescheduleBookings).toHaveBeenCalledWith(["booking1", "booking2"]);
    });

    it("does nothing when no bookings found", async () => {
      vi.mocked(prisma.booking.findMany).mockResolvedValue([]);

      await optOutPhone("owner1", "+35679123456");

      // When no bookings found, updateMany and rescheduleBookings are not called
      expect(prisma.booking.updateMany).not.toHaveBeenCalled();
      expect(rescheduleBookings).not.toHaveBeenCalled();
    });
  });

  describe("phoneIsOptedOut", () => {
    it("returns true when phone is opted out", async () => {
      vi.mocked(prisma.booking.count).mockResolvedValue(1);

      const result = await phoneIsOptedOut("owner1", "+35679123456");

      expect(result).toBe(true);
      expect(prisma.booking.count).toHaveBeenCalledWith({
        where: {
          guestPhone: "+35679123456",
          optedOutAt: { not: null },
          apartment: { ownerId: "owner1" },
        },
      });
    });

    it("returns false when phone is not opted out", async () => {
      vi.mocked(prisma.booking.count).mockResolvedValue(0);

      const result = await phoneIsOptedOut("owner1", "+35679123456");

      expect(result).toBe(false);
    });
  });
});
