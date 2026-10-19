import { describe, it, expect } from "vitest";
import {
  formatDateLocal,
  buildValues,
  pickTranslation,
  renderText,
} from "@/lib/message-render";

describe("message-render", () => {
  describe("formatDateLocal", () => {
    it("formats dates in English", () => {
      const result = formatDateLocal("2026-11-05", "en");
      expect(result).toMatch(/November/);
      expect(result).toMatch(/5/);
    });

    it("formats dates in German", () => {
      const result = formatDateLocal("2026-11-05", "de");
      expect(result).toMatch(/November/);
    });

    it("formats dates in Arabic", () => {
      const result = formatDateLocal("2026-11-05", "ar");
      expect(result).toBeTruthy();
    });

    it("formats dates in Maltese", () => {
      const result = formatDateLocal("2026-11-05", "mt");
      expect(result).toBeTruthy();
    });

    it("falls back to English for unsupported language", () => {
      const result = formatDateLocal("2026-11-05", "xx");
      expect(result).toMatch(/November/);
    });
  });

  describe("buildValues", () => {
    const booking = {
      guestName: "Anna Maria Schmidt",
      checkIn: new Date("2026-11-05T14:00:00.000Z"),
      checkOut: new Date("2026-11-10T11:00:00.000Z"),
    };

    const apartment = {
      name: "Seaview Apartment with a very long name that should be truncated",
      checkInTime: "14:00",
      checkOutTime: "11:00",
      reviewUrl: "https://example.com/review",
    };

    it("extracts first name and truncates", () => {
      const result = buildValues(booking, apartment, "en");
      expect(result.guestName).toBe("Anna");
    });

    it("truncates long apartment names", () => {
      const result = buildValues(booking, apartment, "en");
      expect(result.apartmentName.length).toBeLessThanOrEqual(60);
    });

    it("uses emoji when name is null", () => {
      const noName = { ...booking, guestName: null };
      const result = buildValues(noName, apartment, "en");
      expect(result.guestName).toBe("👋");
    });

    it("cleans whitespace from values", () => {
      const messyApt = {
        ...apartment,
        name: "  Seaview  Apartment  ",
      };
      const result = buildValues(booking, messyApt, "en");
      expect(result.apartmentName).toBe("Seaview Apartment");
    });

    it("includes formatted date", () => {
      const result = buildValues(booking, apartment, "en");
      expect(result.checkInDate).toBeTruthy();
      expect(typeof result.checkInDate).toBe("string");
    });

    it("includes times", () => {
      const result = buildValues(booking, apartment, "en");
      expect(result.checkInTime).toBe("14:00");
      expect(result.checkOutTime).toBe("11:00");
    });

    it("includes review URL", () => {
      const result = buildValues(booking, apartment, "en");
      expect(result.reviewUrl).toBe("https://example.com/review");
    });

    it("handles missing review URL", () => {
      const noReview = { ...apartment, reviewUrl: null };
      const result = buildValues(booking, noReview, "en");
      expect(result.reviewUrl).toBe("");
    });
  });

  describe("pickTranslation", () => {
    const translations = [
      { language: "en", body: "Hello", approval: "APPROVED", contentSid: "HX123" },
      { language: "de", body: "Hallo", approval: "APPROVED", contentSid: "HX124" },
      { language: "fr", body: "Bonjour", approval: "NONE", contentSid: null },
      { language: "it", body: "Ciao", approval: "PENDING", contentSid: "HX125" },
    ];

    it("picks guest language when approved in production", () => {
      const result = pickTranslation(translations, "de", "en", "production");
      expect(result).not.toBeNull();
      expect(result?.translation.language).toBe("de");
      expect(result?.usedFallback).toBe(false);
    });

    it("falls back to fallback language when guest not approved in production", () => {
      const result = pickTranslation(translations, "fr", "en", "production");
      expect(result).not.toBeNull();
      expect(result?.translation.language).toBe("en");
      expect(result?.usedFallback).toBe(true);
    });

    it("returns null when neither approved in production", () => {
      const result = pickTranslation(translations, "it", "fr", "production");
      expect(result).toBeNull();
    });

    it("ignores approval in dry-run mode", () => {
      const result = pickTranslation(translations, "fr", "en", "dry-run");
      expect(result).not.toBeNull();
      expect(result?.translation.language).toBe("fr");
      expect(result?.usedFallback).toBe(false);
    });

    it("ignores approval in sandbox mode", () => {
      const result = pickTranslation(translations, "fr", "en", "sandbox");
      expect(result).not.toBeNull();
      expect(result?.translation.language).toBe("fr");
    });

    it("returns null when translation not found", () => {
      const result = pickTranslation(translations, "es", "zh", "dry-run");
      expect(result).toBeNull();
    });

    it("requires contentSid for production approval", () => {
      const noSid = [
        { language: "en", body: "Hello", approval: "APPROVED", contentSid: null },
      ];
      const result = pickTranslation(noSid, "en", "de", "production");
      expect(result).toBeNull();
    });
  });

  describe("renderText", () => {
    it("fills template with values", () => {
      const template = "Hello {{guestName}}, welcome to {{apartmentName}}";
      const values = { guestName: "Anna", apartmentName: "Seaview" };
      const result = renderText(template, values);
      expect(result).toBe("Hello Anna, welcome to Seaview");
    });

    it("handles missing values gracefully", () => {
      const template = "Hello {{guestName}}";
      const values = {};
      const result = renderText(template, values);
      expect(result).toBe("Hello ");
    });
  });
});
