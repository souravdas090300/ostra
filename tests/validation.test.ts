import { describe, it, expect } from "vitest";
import { isSafeFeedUrl, apartmentSchema, toCents } from "@/lib/validation";
import { normaliseLanguage, isRtl, LANGUAGES, LANGUAGE_CODES } from "@/lib/languages";

describe("isSafeFeedUrl", () => {
  it("accepts valid Airbnb iCal URLs", () => {
    expect(isSafeFeedUrl("https://www.airbnb.com/calendar/ical/123.ics?s=abc")).toBe(true);
  });

  it("accepts valid Booking.com iCal URLs", () => {
    expect(isSafeFeedUrl("https://www.booking.com/calendar/ical/123.ics")).toBe(true);
  });

  it("rejects http:// URLs", () => {
    expect(isSafeFeedUrl("http://example.com/calendar.ics")).toBe(false);
  });

  it("rejects localhost", () => {
    expect(isSafeFeedUrl("https://localhost/calendar.ics")).toBe(false);
  });

  it("rejects 127.0.0.1", () => {
    expect(isSafeFeedUrl("https://127.0.0.1/calendar.ics")).toBe(false);
  });

  it("rejects IPv6 localhost", () => {
    expect(isSafeFeedUrl("https://[::1]/calendar.ics")).toBe(false);
  });

  it("rejects URLs with username:password", () => {
    expect(isSafeFeedUrl("https://user:pw@example.com/calendar.ics")).toBe(false);
  });

  it("rejects non-standard ports", () => {
    expect(isSafeFeedUrl("https://example.com:8443/calendar.ics")).toBe(false);
  });

  it("rejects file:// URLs", () => {
    expect(isSafeFeedUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects javascript: URLs", () => {
    expect(isSafeFeedUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects .local domains", () => {
    expect(isSafeFeedUrl("https://example.local/calendar.ics")).toBe(false);
  });

  it("rejects .internal domains", () => {
    expect(isSafeFeedUrl("https://example.internal/calendar.ics")).toBe(false);
  });

  it("rejects IP addresses", () => {
    expect(isSafeFeedUrl("https://192.168.1.1/calendar.ics")).toBe(false);
  });
});

describe("apartmentSchema", () => {
  it("rejects invalid time format 25:00", () => {
    const result = apartmentSchema.safeParse({
      name: "Test",
      address: "123 St",
      checkInTime: "25:00",
      checkOutTime: "11:00",
      maxGuests: 2,
      bedrooms: 1,
      minNights: 1,
      baseNightlyEuros: 100,
      cleaningFeeEuros: 50,
      info: "",
      publicInfo: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = apartmentSchema.safeParse({
      name: "",
      address: "123 St",
      checkInTime: "15:00",
      checkOutTime: "11:00",
      maxGuests: 2,
      bedrooms: 1,
      minNights: 1,
      baseNightlyEuros: 100,
      cleaningFeeEuros: 50,
      info: "",
      publicInfo: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects maxGuests = 0", () => {
    const result = apartmentSchema.safeParse({
      name: "Test",
      address: "123 St",
      checkInTime: "15:00",
      checkOutTime: "11:00",
      maxGuests: 0,
      bedrooms: 1,
      minNights: 1,
      baseNightlyEuros: 100,
      cleaningFeeEuros: 50,
      info: "",
      publicInfo: "",
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid defaults", () => {
    const result = apartmentSchema.safeParse({
      name: "Test",
      address: "123 St",
      checkInTime: "15:00",
      checkOutTime: "11:00",
      maxGuests: 2,
      bedrooms: 1,
      minNights: 1,
      baseNightlyEuros: 100,
      cleaningFeeEuros: 50,
      info: "",
      publicInfo: "",
    });
    expect(result.success).toBe(true);
  });
});

describe("toCents", () => {
  it("converts euros to cents", () => {
    expect(toCents(100)).toBe(10000);
    expect(toCents(89.90)).toBe(8990);
    expect(toCents(0)).toBe(0);
  });
});

describe("normaliseLanguage", () => {
  it("normalises pt-BR to pt", () => {
    expect(normaliseLanguage("pt-BR")).toBe("pt");
  });

  it("normalises NO to nb (Norwegian)", () => {
    expect(normaliseLanguage("NO")).toBe("nb");
  });

  it("normalises nn to nb (Norwegian Nynorsk)", () => {
    expect(normaliseLanguage("nn")).toBe("nb");
  });

  it("returns null for unsupported language", () => {
    expect(normaliseLanguage("xx")).toBe(null);
  });

  it("returns null for null/undefined", () => {
    expect(normaliseLanguage(null)).toBe(null);
    expect(normaliseLanguage(undefined)).toBe(null);
  });

  it("handles case insensitivity", () => {
    expect(normaliseLanguage("EN")).toBe("en");
    expect(normaliseLanguage("De")).toBe("de");
  });
});

describe("isRtl", () => {
  it("returns true for Arabic", () => {
    expect(isRtl("ar")).toBe(true);
  });

  it("returns false for English", () => {
    expect(isRtl("en")).toBe(false);
  });

  it("returns false for left-to-right languages", () => {
    expect(isRtl("de")).toBe(false);
    expect(isRtl("fr")).toBe(false);
    expect(isRtl("it")).toBe(false);
  });
});

describe("LANGUAGE_CODES uniqueness", () => {
  it("every language has a unique code", () => {
    const codes = LANGUAGES.map((l) => l.code);
    const uniqueCodes = new Set(codes);
    expect(codes.length).toBe(uniqueCodes.size);
  });
});

describe("LANGUAGE_CODES array", () => {
  it("is a tuple with at least one element", () => {
    expect(LANGUAGE_CODES.length).toBeGreaterThan(0);
    expect(typeof LANGUAGE_CODES[0]).toBe("string");
  });
});
