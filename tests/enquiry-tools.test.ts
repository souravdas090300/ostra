import { describe, it, expect, beforeEach, vi } from "vitest";
import { runTool, dataTools, RESPOND_TOOL } from "@/lib/enquiry-tools";
import { prisma } from "@/lib/db";
import { getAvailability, findAlternatives, ensureFreshCalendars, getAvailabilityFresh } from "@/lib/availability";

vi.mock("@/lib/db");
vi.mock("@/lib/availability");

describe("E2 - Enquiry Tool Runner", () => {
  const mockCtx = {
    ownerId: "owner-1",
    leadId: "lead-1",
    now: new Date("2026-10-25T10:00:00Z"),
    results: new Map(),
    saved: {},
    allowedAmounts: new Set(),
    allowedText: "Apartment info text",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx.results.clear();
    mockCtx.saved = {};
    mockCtx.allowedAmounts.clear();
  });

  describe("check_availability tool", () => {
    it("validates date format", async () => {
      const result = await runTool(
        "check_availability",
        { check_in: "invalid", check_out: "2026-10-26", guests: 2 },
        mockCtx,
      );
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain("Invalid date format");
    });

    it("validates check_out after check_in", async () => {
      const result = await runTool(
        "check_availability",
        { check_in: "2026-10-26", check_out: "2026-10-25", guests: 2 },
        mockCtx,
      );
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain("Check-out must be after check-in");
    });

    it("validates guest count range", async () => {
      const result = await runTool(
        "check_availability",
        { check_in: "2026-10-25", check_out: "2026-10-26", guests: 0 },
        mockCtx,
      );
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain("Guests must be between 1 and 30");
    });

    it("validates maximum stay", async () => {
      const result = await runTool(
        "check_availability",
        { check_in: "2026-10-25", check_out: "2027-02-01", guests: 2 },
        mockCtx,
      );
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain("Maximum stay is 60 nights");
    });

    it("calls getAvailabilityFresh before checking availability", async () => {
      vi.mocked(getAvailabilityFresh).mockResolvedValue({
        results: [],
        calendarsStale: false,
      });
      vi.mocked(findAlternatives).mockResolvedValue({
        otherApartments: [],
        shiftedDates: [],
      });

      await runTool(
        "check_availability",
        { check_in: "2026-10-25", check_out: "2026-10-26", guests: 2 },
        mockCtx,
      );

      expect(getAvailabilityFresh).toHaveBeenCalledWith(
        mockCtx.ownerId,
        expect.objectContaining({
          checkIn: expect.any(Date),
          checkOut: expect.any(Date),
          guests: 2,
        }),
      );
    });

    it("records results in context", async () => {
      vi.mocked(getAvailabilityFresh).mockResolvedValue({
        results: [
          {
            apartmentId: "apt-1",
            name: "Test Apt",
            available: true,
            nights: 1,
            minNights: 1,
            maxGuests: 4,
            bedrooms: 1,
            totalCents: 5000,
            verified: true,
          },
        ],
        calendarsStale: false,
      });

      await runTool(
        "check_availability",
        { check_in: "2026-10-25", check_out: "2026-10-26", guests: 2 },
        mockCtx,
      );

      expect(mockCtx.results.has("apt-1")).toBe(true);
      expect(mockCtx.allowedAmounts.has(50)).toBe(true);
    });

    it("finds alternatives when unavailable", async () => {
      vi.mocked(getAvailabilityFresh).mockResolvedValue({
        results: [
          {
            apartmentId: "apt-1",
            name: "Test Apt",
            available: false,
            reason: "BOOKED",
            nights: 1,
            minNights: 1,
            maxGuests: 4,
            bedrooms: 1,
            verified: true,
          },
        ],
        calendarsStale: false,
      });
      vi.mocked(findAlternatives).mockResolvedValue({
        otherApartments: [],
        shiftedDates: [],
      });

      const result = await runTool(
        "check_availability",
        { check_in: "2026-10-25", check_out: "2026-10-26", guests: 2 },
        mockCtx,
      );

      const parsed = JSON.parse(result);
      expect(parsed.available).toBe(false);
      expect(findAlternatives).toHaveBeenCalled();
    });

    it("returns availability result when available", async () => {
      vi.mocked(getAvailabilityFresh).mockResolvedValue({
        results: [
          {
            apartmentId: "apt-1",
            name: "Test Apt",
            available: true,
            nights: 1,
            minNights: 1,
            maxGuests: 4,
            bedrooms: 1,
            totalCents: 5000,
            verified: true,
          },
        ],
        calendarsStale: false,
      });

      const result = await runTool(
        "check_availability",
        { check_in: "2026-10-25", check_out: "2026-10-26", guests: 2 },
        mockCtx,
      );

      const parsed = JSON.parse(result);
      expect(parsed.available).toBe(true);
      expect(parsed.apartments).toHaveLength(1);
      expect(parsed.apartments[0].total_eur).toBe(50);
    });
  });

  describe("get_apartment_info tool", () => {
    it("returns public information for apartment", async () => {
      (prisma.apartment.findFirst as any).mockResolvedValue({
        id: "apt-1",
        name: "Test Apt",
        publicInfo: "Public info here",
        bedrooms: 2,
        maxGuests: 4,
        minNights: 1,
      });

      const result = await runTool(
        "get_apartment_info",
        { apartment_name: "Test Apt" },
        mockCtx,
      );

      const parsed = JSON.parse(result);
      expect(parsed.public_info).toBe("Public info here");
      expect(parsed.bedrooms).toBe(2);
      expect(mockCtx.allowedText).toContain("Public info here");
    });

    it("returns error for unknown apartment", async () => {
      (prisma.apartment.findFirst as any).mockResolvedValue(null);
      (prisma.apartment.findMany as any).mockResolvedValue([
        { name: "Other Apt" },
      ]);

      const result = await runTool(
        "get_apartment_info",
        { apartment_name: "Unknown" },
        mockCtx,
      );

      const parsed = JSON.parse(result);
      expect(parsed.error).toBe("Unknown apartment");
      expect(parsed.apartments).toEqual(["Other Apt"]);
    });
  });

  describe("save_lead_details tool", () => {
    it("saves name to context", async () => {
      const result = await runTool(
        "save_lead_details",
        { name: "John" },
        mockCtx,
      );

      const parsed = JSON.parse(result);
      expect(parsed.saved.name).toBe("John");
      expect(mockCtx.saved.name).toBe("John");
    });

    it("truncates name to 60 characters when saving", async () => {
      const longName = "A".repeat(60);
      await runTool("save_lead_details", { name: longName }, mockCtx);

      expect(mockCtx.saved.name).toHaveLength(60);
    });

    it("returns error for name > 60 characters", async () => {
      const result = await runTool(
        "save_lead_details",
        { name: "A".repeat(61) },
        mockCtx,
      );

      const parsed = JSON.parse(result);
      expect(parsed.error).toContain("Name must be at most 60 characters");
    });

    it("saves valid dates", async () => {
      await runTool(
        "save_lead_details",
        { check_in: "2026-10-25", check_out: "2026-10-26" },
        mockCtx,
      );

      expect(mockCtx.saved.checkInYmd).toBe("2026-10-25");
      expect(mockCtx.saved.checkOutYmd).toBe("2026-10-26");
    });

    it("saves guest count", async () => {
      await runTool("save_lead_details", { guests: 4 }, mockCtx);

      expect(mockCtx.saved.guests).toBe(4);
    });

    it("saves apartment ID when found", async () => {
      (prisma.apartment.findFirst as any).mockResolvedValue({
        id: "apt-1",
        name: "Test Apt",
      });

      await runTool(
        "save_lead_details",
        { apartment_name: "Test Apt" },
        mockCtx,
      );

      expect(mockCtx.saved.apartmentId).toBe("apt-1");
    });
  });

  describe("unknown tool", () => {
    it("returns error for unknown tool name", async () => {
      const result = await runTool("unknown_tool", {}, mockCtx);

      const parsed = JSON.parse(result);
      expect(parsed.error).toBe("Unknown tool");
    });
  });
});
