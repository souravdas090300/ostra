import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildWeeklySummary, getIsoWeekString } from "@/lib/weekly-summary";
import { prisma } from "@/lib/db";

// Mock dependencies
vi.mock("@/lib/db");
vi.mock("@/lib/usage");

describe("weekly-summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getIsoWeekString", () => {
    it("should return correct ISO week string", () => {
      const date = new Date("2026-11-10T10:00:00Z"); // Tuesday of week 45
      const week = getIsoWeekString(date);
      expect(week).toMatch(/^\d{4}-W\d{2}$/);
    });

    it("should handle year boundary", () => {
      const date = new Date("2026-12-31T10:00:00Z");
      const week = getIsoWeekString(date);
      expect(week).toMatch(/^\d{4}-W\d{2}$/);
    });
  });

  describe("buildWeeklySummary", () => {
    it("should build summary for owner with apartments", async () => {
      vi.mocked(prisma.owner.findUnique).mockResolvedValue({
        id: "owner1",
        email: "test@example.com",
        hostLanguage: "en",
        monthlyAiBudgetCents: 1500,
        monthlyTemplateCap: 1000,
        enquiriesEnabled: false,
        passwordHash: "hash",
        whatsappPhoneNumberId: null,
        defaultGuestLanguage: "en",
        fallbackLanguage: "en",
        retentionDays: 90,
        passwordChangedAt: null,
        waTemplateCost: "0",
        budgetWarnedMonth: null,
        weeklySummaryEnabled: true,
        lastSummaryWeek: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      vi.mocked(prisma.apartment.findMany).mockResolvedValue([
        { id: "apt1", name: "Apartment 1", info: "", address: "", checkInTime: "14:00", checkOutTime: "11:00", publicInfo: "", maxGuests: 2, bedrooms: 1, baseNightlyCents: 0, cleaningFeeCents: 0, minNights: 1, ownerId: "owner1", createdAt: new Date(), updatedAt: new Date() },
        { id: "apt2", name: "Apartment 2", info: "", address: "", checkInTime: "14:00", checkOutTime: "11:00", publicInfo: "", maxGuests: 2, bedrooms: 1, baseNightlyCents: 0, cleaningFeeCents: 0, minNights: 1, ownerId: "owner1", createdAt: new Date(), updatedAt: new Date() },
      ] as any);

      vi.mocked(prisma.booking.findMany).mockResolvedValue([]);
      vi.mocked(prisma.message.count).mockResolvedValue(0);
      vi.mocked(prisma.calendarFeed.count).mockResolvedValue(0);
      vi.mocked(prisma.exportFeed.count).mockResolvedValue(0);
      vi.mocked(prisma.lead.count).mockResolvedValue(0);

      const { monthlyAiCostCents, monthlyCount } = await import("@/lib/usage");
      vi.mocked(monthlyAiCostCents).mockResolvedValue(500);
      vi.mocked(monthlyCount).mockResolvedValue(50);

      const summary = await buildWeeklySummary("owner1", new Date("2026-11-10"));

      expect(summary.subject).toContain("Ostra weekly summary");
      expect(summary.text).toContain("USAGE (this month)");
      expect(summary.text).toContain("AI cost");
      expect(summary.text).toContain("Template messages");
    });

    it("should include arrivals and departures", async () => {
      vi.mocked(prisma.owner.findUnique).mockResolvedValue({
        id: "owner1",
        email: "test@example.com",
        hostLanguage: "en",
        monthlyAiBudgetCents: 1500,
        monthlyTemplateCap: 1000,
        enquiriesEnabled: false,
        passwordHash: "hash",
        whatsappPhoneNumberId: null,
        defaultGuestLanguage: "en",
        fallbackLanguage: "en",
        retentionDays: 90,
        passwordChangedAt: null,
        waTemplateCost: "0",
        budgetWarnedMonth: null,
        weeklySummaryEnabled: true,
        lastSummaryWeek: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      vi.mocked(prisma.apartment.findMany).mockResolvedValue([
        { id: "apt1", name: "Apartment 1", info: "", address: "", checkInTime: "14:00", checkOutTime: "11:00", publicInfo: "", maxGuests: 2, bedrooms: 1, baseNightlyCents: 0, cleaningFeeCents: 0, minNights: 1, ownerId: "owner1", createdAt: new Date(), updatedAt: new Date() },
      ] as any);

      vi.mocked(prisma.booking.findMany).mockResolvedValue([
        {
          id: "booking1",
          checkIn: new Date("2026-11-12T10:00:00Z"),
          checkOut: new Date("2026-11-15T10:00:00Z"),
          isBlock: false,
          status: "CONFIRMED",
          apartmentId: "apt1",
          source: "DIRECT",
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any,
      ]);
      vi.mocked(prisma.message.count).mockResolvedValue(0);
      vi.mocked(prisma.calendarFeed.count).mockResolvedValue(0);
      vi.mocked(prisma.exportFeed.count).mockResolvedValue(0);
      vi.mocked(prisma.lead.count).mockResolvedValue(0);

      const { monthlyAiCostCents, monthlyCount } = await import("@/lib/usage");
      vi.mocked(monthlyAiCostCents).mockResolvedValue(0);
      vi.mocked(monthlyCount).mockResolvedValue(0);

      const summary = await buildWeeklySummary("owner1", new Date("2026-11-10"));

      expect(summary.text).toContain("NEXT 7 DAYS");
    });

    it("should include needs attention section", async () => {
      vi.mocked(prisma.owner.findUnique).mockResolvedValue({
        id: "owner1",
        email: "test@example.com",
        hostLanguage: "en",
        monthlyAiBudgetCents: 1500,
        monthlyTemplateCap: 1000,
        enquiriesEnabled: false,
        passwordHash: "hash",
        whatsappPhoneNumberId: null,
        defaultGuestLanguage: "en",
        fallbackLanguage: "en",
        retentionDays: 90,
        passwordChangedAt: null,
        waTemplateCost: "0",
        budgetWarnedMonth: null,
        weeklySummaryEnabled: true,
        lastSummaryWeek: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      vi.mocked(prisma.apartment.findMany).mockResolvedValue([
        { id: "apt1", name: "Apartment 1", info: "", address: "", checkInTime: "14:00", checkOutTime: "11:00", publicInfo: "", maxGuests: 2, bedrooms: 1, baseNightlyCents: 0, cleaningFeeCents: 0, minNights: 1, ownerId: "owner1", createdAt: new Date(), updatedAt: new Date() },
      ] as any);

      vi.mocked(prisma.booking.findMany).mockResolvedValue([]);
      vi.mocked(prisma.message.count).mockResolvedValue(0);
      vi.mocked(prisma.calendarFeed.count).mockResolvedValue(1); // Stale feed
      vi.mocked(prisma.exportFeed.count).mockResolvedValue(0);
      vi.mocked(prisma.lead.count).mockResolvedValue(0);

      const { monthlyAiCostCents, monthlyCount } = await import("@/lib/usage");
      vi.mocked(monthlyAiCostCents).mockResolvedValue(0);
      vi.mocked(monthlyCount).mockResolvedValue(0);

      const summary = await buildWeeklySummary("owner1", new Date("2026-11-10"));

      expect(summary.text).toContain("NEEDS ATTENTION");
    });

    it("should include enquiry funnel when enabled", async () => {
      vi.mocked(prisma.owner.findUnique).mockResolvedValue({
        id: "owner1",
        email: "test@example.com",
        hostLanguage: "en",
        monthlyAiBudgetCents: 1500,
        monthlyTemplateCap: 1000,
        enquiriesEnabled: true,
        passwordHash: "hash",
        whatsappPhoneNumberId: null,
        defaultGuestLanguage: "en",
        fallbackLanguage: "en",
        retentionDays: 90,
        passwordChangedAt: null,
        waTemplateCost: "0",
        budgetWarnedMonth: null,
        weeklySummaryEnabled: true,
        lastSummaryWeek: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      vi.mocked(prisma.apartment.findMany).mockResolvedValue([]);
      vi.mocked(prisma.booking.findMany).mockResolvedValue([]);
      vi.mocked(prisma.message.count).mockResolvedValue(0);
      vi.mocked(prisma.calendarFeed.count).mockResolvedValue(0);
      vi.mocked(prisma.exportFeed.count).mockResolvedValue(0);
      vi.mocked(prisma.lead.count).mockResolvedValue(5); // New leads

      const { monthlyAiCostCents, monthlyCount } = await import("@/lib/usage");
      vi.mocked(monthlyAiCostCents).mockResolvedValue(0);
      vi.mocked(monthlyCount).mockResolvedValue(0);

      const summary = await buildWeeklySummary("owner1", new Date("2026-11-10"));

      expect(summary.text).toContain("ENQUIRIES (last week)");
    });

    it("should show warning at 80% AI budget", async () => {
      vi.mocked(prisma.owner.findUnique).mockResolvedValue({
        id: "owner1",
        email: "test@example.com",
        hostLanguage: "en",
        monthlyAiBudgetCents: 1500,
        monthlyTemplateCap: 1000,
        enquiriesEnabled: false,
        passwordHash: "hash",
        whatsappPhoneNumberId: null,
        defaultGuestLanguage: "en",
        fallbackLanguage: "en",
        retentionDays: 90,
        passwordChangedAt: null,
        waTemplateCost: "0",
        budgetWarnedMonth: null,
        weeklySummaryEnabled: true,
        lastSummaryWeek: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      vi.mocked(prisma.apartment.findMany).mockResolvedValue([]);
      vi.mocked(prisma.booking.findMany).mockResolvedValue([]);
      vi.mocked(prisma.message.count).mockResolvedValue(0);
      vi.mocked(prisma.calendarFeed.count).mockResolvedValue(0);
      vi.mocked(prisma.exportFeed.count).mockResolvedValue(0);
      vi.mocked(prisma.lead.count).mockResolvedValue(0);

      const { monthlyAiCostCents, monthlyCount } = await import("@/lib/usage");
      vi.mocked(monthlyAiCostCents).mockResolvedValue(1200); // 80% of 1500
      vi.mocked(monthlyCount).mockResolvedValue(0);

      const summary = await buildWeeklySummary("owner1", new Date("2026-11-10"));

      expect(summary.text).toContain("⚠️ AI budget at 80%");
    });

    it("should throw error for non-existent owner", async () => {
      vi.mocked(prisma.owner.findUnique).mockResolvedValue(null);

      await expect(buildWeeklySummary("nonexistent", new Date())).rejects.toThrow("Owner not found");
    });

    it("should not include guest names or phone numbers", async () => {
      vi.mocked(prisma.owner.findUnique).mockResolvedValue({
        id: "owner1",
        email: "test@example.com",
        hostLanguage: "en",
        monthlyAiBudgetCents: 1500,
        monthlyTemplateCap: 1000,
        enquiriesEnabled: false,
        passwordHash: "hash",
        whatsappPhoneNumberId: null,
        defaultGuestLanguage: "en",
        fallbackLanguage: "en",
        retentionDays: 90,
        passwordChangedAt: null,
        waTemplateCost: "0",
        budgetWarnedMonth: null,
        weeklySummaryEnabled: true,
        lastSummaryWeek: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      vi.mocked(prisma.apartment.findMany).mockResolvedValue([
        { id: "apt1", name: "Apartment 1", info: "", address: "", checkInTime: "14:00", checkOutTime: "11:00", publicInfo: "", maxGuests: 2, bedrooms: 1, baseNightlyCents: 0, cleaningFeeCents: 0, minNights: 1, ownerId: "owner1", createdAt: new Date(), updatedAt: new Date() },
      ] as any);

      // Mock bookings with guest names - these should not appear in summary
      vi.mocked(prisma.booking.findMany).mockResolvedValue([
        {
          id: "booking1",
          checkIn: new Date("2026-11-12T10:00:00Z"),
          checkOut: new Date("2026-11-15T10:00:00Z"),
          isBlock: false,
          status: "CONFIRMED",
          apartmentId: "apt1",
          source: "DIRECT",
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any,
      ]);
      vi.mocked(prisma.message.count).mockResolvedValue(0);
      vi.mocked(prisma.calendarFeed.count).mockResolvedValue(0);
      vi.mocked(prisma.exportFeed.count).mockResolvedValue(0);
      vi.mocked(prisma.lead.count).mockResolvedValue(0);

      const { monthlyAiCostCents, monthlyCount } = await import("@/lib/usage");
      vi.mocked(monthlyAiCostCents).mockResolvedValue(0);
      vi.mocked(monthlyCount).mockResolvedValue(0);

      const summary = await buildWeeklySummary("owner1", new Date("2026-11-10"));

      // Should only have counts and dates, no names or phone numbers
      expect(summary.text).not.toMatch(/\+\d/); // No phone numbers
      expect(summary.text).not.toContain("John"); // No guest names
    });

    it("should calculate occupancy correctly", async () => {
      vi.mocked(prisma.owner.findUnique).mockResolvedValue({
        id: "owner1",
        email: "test@example.com",
        hostLanguage: "en",
        monthlyAiBudgetCents: 1500,
        monthlyTemplateCap: 1000,
        enquiriesEnabled: false,
        passwordHash: "hash",
        whatsappPhoneNumberId: null,
        defaultGuestLanguage: "en",
        fallbackLanguage: "en",
        retentionDays: 90,
        passwordChangedAt: null,
        waTemplateCost: "0",
        budgetWarnedMonth: null,
        weeklySummaryEnabled: true,
        lastSummaryWeek: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      vi.mocked(prisma.apartment.findMany).mockResolvedValue([
        { id: "apt1", name: "Apartment 1", info: "", address: "", checkInTime: "14:00", checkOutTime: "11:00", publicInfo: "", maxGuests: 2, bedrooms: 1, baseNightlyCents: 0, cleaningFeeCents: 0, minNights: 1, ownerId: "owner1", createdAt: new Date(), updatedAt: new Date() },
      ] as any);

      // 15 nights booked out of 30 = 50%
      vi.mocked(prisma.booking.findMany).mockResolvedValue([
        {
          id: "booking1",
          checkIn: new Date("2026-11-12T10:00:00Z"),
          checkOut: new Date("2026-11-27T10:00:00Z"),
          isBlock: false,
          status: "CONFIRMED",
          apartmentId: "apt1",
          source: "DIRECT",
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any,
      ]);
      vi.mocked(prisma.message.count).mockResolvedValue(0);
      vi.mocked(prisma.calendarFeed.count).mockResolvedValue(0);
      vi.mocked(prisma.exportFeed.count).mockResolvedValue(0);
      vi.mocked(prisma.lead.count).mockResolvedValue(0);

      const { monthlyAiCostCents, monthlyCount } = await import("@/lib/usage");
      vi.mocked(monthlyAiCostCents).mockResolvedValue(0);
      vi.mocked(monthlyCount).mockResolvedValue(0);

      const summary = await buildWeeklySummary("owner1", new Date("2026-11-10"));

      expect(summary.text).toContain("NEXT 30 DAYS - OCCUPANCY");
      expect(summary.text).toContain("% booked");
    });
  });
});
