import { describe, it, expect } from "vitest";
import { getAvailability, findAlternatives, ensureFreshCalendars } from "../lib/availability";

describe("availability database layer", () => {
  describe("getAvailability", () => {
    it("returns an array of availability results", async () => {
      // This is a basic smoke test - full integration testing would require a test database
      const results = await getAvailability("test-owner-id", {
        checkIn: new Date("2026-03-15"),
        checkOut: new Date("2026-03-18"),
        guests: 2,
      });
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe("findAlternatives", () => {
    it("returns other apartments and shifted dates", async () => {
      const result = await findAlternatives("test-owner-id", {
        checkIn: new Date("2026-03-15"),
        checkOut: new Date("2026-03-18"),
        guests: 2,
      });
      expect(result.otherApartments).toBeDefined();
      expect(result.shiftedDates).toBeDefined();
    });
  });

  describe("ensureFreshCalendars", () => {
    it("completes without error", async () => {
      await expect(
        ensureFreshCalendars("test-owner-id", undefined),
      ).resolves.not.toThrow();
    });
  });
});
