import { describe, it, expect } from "vitest";
import {
  nightlyPrice,
  calendarVerified,
  requiredMinNights,
  evaluateApartment,
  shiftedWindows,
  reasonToText,
  MAX_ENQUIRY_NIGHTS,
  MAX_FUTURE_DAYS,
  CALENDAR_STALE_MS,
  type AptInput,
  type StayRow,
  type RateRow,
  type FeedHealth,
} from "../lib/availability-core";

describe("nightlyPrice", () => {
  it("returns base price when no rate covers the date", () => {
    const rates: RateRow[] = [];
    expect(nightlyPrice("2026-03-12", rates, 10000)).toBe(10000);
  });

  it("returns the covering rate price", () => {
    const rates: RateRow[] = [
      {
        startYmd: "2026-03-01",
        endYmd: "2026-03-31",
        nightlyCents: 15000,
        minNights: null,
        createdAt: new Date("2026-01-01"),
      },
    ];
    expect(nightlyPrice("2026-03-12", rates, 10000)).toBe(15000);
  });

  it("narrowest rate wins when multiple rates cover the date", () => {
    const rates: RateRow[] = [
      {
        startYmd: "2026-03-01",
        endYmd: "2026-03-31",
        nightlyCents: 10000,
        minNights: null,
        createdAt: new Date("2026-01-01"),
      },
      {
        startYmd: "2026-03-10",
        endYmd: "2026-03-20",
        nightlyCents: 15000,
        minNights: null,
        createdAt: new Date("2026-01-01"),
      },
    ];
    expect(nightlyPrice("2026-03-12", rates, 5000)).toBe(15000);
  });

  it("tie goes to the newest rate", () => {
    const rates: RateRow[] = [
      {
        startYmd: "2026-03-10",
        endYmd: "2026-03-20",
        nightlyCents: 10000,
        minNights: null,
        createdAt: new Date("2026-01-01"),
      },
      {
        startYmd: "2026-03-10",
        endYmd: "2026-03-20",
        nightlyCents: 15000,
        minNights: null,
        createdAt: new Date("2026-01-02"),
      },
    ];
    expect(nightlyPrice("2026-03-12", rates, 5000)).toBe(15000);
  });

  it("inclusive boundaries work correctly", () => {
    const rates: RateRow[] = [
      {
        startYmd: "2026-03-10",
        endYmd: "2026-03-20",
        nightlyCents: 15000,
        minNights: null,
        createdAt: new Date("2026-01-01"),
      },
    ];
    expect(nightlyPrice("2026-03-10", rates, 10000)).toBe(15000);
    expect(nightlyPrice("2026-03-20", rates, 10000)).toBe(15000);
    expect(nightlyPrice("2026-03-09", rates, 10000)).toBe(10000);
    expect(nightlyPrice("2026-03-21", rates, 10000)).toBe(10000);
  });

  it("adjacent rates work correctly", () => {
    const rates: RateRow[] = [
      {
        startYmd: "2026-03-01",
        endYmd: "2026-03-10",
        nightlyCents: 10000,
        minNights: null,
        createdAt: new Date("2026-01-01"),
      },
      {
        startYmd: "2026-03-11",
        endYmd: "2026-03-20",
        nightlyCents: 15000,
        minNights: null,
        createdAt: new Date("2026-01-01"),
      },
    ];
    expect(nightlyPrice("2026-03-10", rates, 5000)).toBe(10000);
    expect(nightlyPrice("2026-03-11", rates, 5000)).toBe(15000);
  });
});

describe("calendarVerified", () => {
  const now = new Date("2026-03-12T12:00:00Z");

  it("returns true when all feeds are fresh and error-free", () => {
    const feeds: FeedHealth[] = [
      {
        lastSuccessAt: new Date(now.getTime() - 2_000_000), // ~33 minutes ago
        lastError: null,
      },
    ];
    expect(calendarVerified(feeds, now)).toBe(true);
  });

  it("returns false when a feed has an error", () => {
    const feeds: FeedHealth[] = [
      {
        lastSuccessAt: new Date(now.getTime() - 2_000_000),
        lastError: "Sync failed",
      },
    ];
    expect(calendarVerified(feeds, now)).toBe(false);
  });

  it("returns false when a feed has never synced", () => {
    const feeds: FeedHealth[] = [
      {
        lastSuccessAt: null,
        lastError: null,
      },
    ];
    expect(calendarVerified(feeds, now)).toBe(false);
  });

  it("returns false when a feed is older than 3 hours", () => {
    const feeds: FeedHealth[] = [
      {
        lastSuccessAt: new Date(now.getTime() - 4 * 3_600_000), // 4 hours ago
        lastError: null,
      },
    ];
    expect(calendarVerified(feeds, now)).toBe(false);
  });

  it("returns true exactly at 3 hours", () => {
    const feeds: FeedHealth[] = [
      {
        lastSuccessAt: new Date(now.getTime() - CALENDAR_STALE_MS),
        lastError: null,
      },
    ];
    expect(calendarVerified(feeds, now)).toBe(true);
  });

  it("returns true when there are no feeds", () => {
    expect(calendarVerified([], now)).toBe(true);
  });
});

describe("requiredMinNights", () => {
  const apt: AptInput = {
    id: "apt1",
    name: "Apartment 1",
    maxGuests: 4,
    bedrooms: 2,
    minNights: 2,
    baseNightlyCents: 10000,
    cleaningFeeCents: 5000,
    rates: [],
    feeds: [],
  };

  it("returns apartment minimum when no rate applies", () => {
    expect(requiredMinNights("2026-03-12", apt)).toBe(2);
  });

  it("returns apartment minimum when rate has no minNights", () => {
    const aptWithRate: AptInput = {
      ...apt,
      rates: [
        {
          startYmd: "2026-03-01",
          endYmd: "2026-03-31",
          nightlyCents: 15000,
          minNights: null,
          createdAt: new Date("2026-01-01"),
        },
      ],
    };
    expect(requiredMinNights("2026-03-12", aptWithRate)).toBe(2);
  });

  it("returns rate minimum when it is higher than apartment minimum", () => {
    const aptWithRate: AptInput = {
      ...apt,
      rates: [
        {
          startYmd: "2026-03-01",
          endYmd: "2026-03-31",
          nightlyCents: 15000,
          minNights: 5,
          createdAt: new Date("2026-01-01"),
        },
      ],
    };
    expect(requiredMinNights("2026-03-12", aptWithRate)).toBe(5);
  });

  it("returns apartment minimum when it is higher than rate minimum", () => {
    const aptWithRate: AptInput = {
      ...apt,
      minNights: 7,
      rates: [
        {
          startYmd: "2026-03-01",
          endYmd: "2026-03-31",
          nightlyCents: 15000,
          minNights: 3,
          createdAt: new Date("2026-01-01"),
        },
      ],
    };
    expect(requiredMinNights("2026-03-12", aptWithRate)).toBe(7);
  });

  it("only applies rate covering check-in night", () => {
    const aptWithRate: AptInput = {
      ...apt,
      rates: [
        {
          startYmd: "2026-03-15",
          endYmd: "2026-03-20",
          nightlyCents: 15000,
          minNights: 7,
          createdAt: new Date("2026-01-01"),
        },
      ],
    };
    expect(requiredMinNights("2026-03-12", aptWithRate)).toBe(2);
  });
});

describe("evaluateApartment", () => {
  const apt: AptInput = {
    id: "apt1",
    name: "Apartment 1",
    maxGuests: 4,
    bedrooms: 2,
    minNights: 2,
    baseNightlyCents: 10000,
    cleaningFeeCents: 5000,
    rates: [],
    feeds: [],
  };
  const now = new Date("2026-03-12T12:00:00Z");

  it("calculates correct total for available stay", () => {
    const result = evaluateApartment(apt, [], {
      inYmd: "2026-03-15",
      outYmd: "2026-03-18",
      guests: 2,
      today: "2026-03-12",
      now,
    });
    expect(result.available).toBe(true);
    expect(result.nights).toBe(3);
    expect(result.totalCents).toBe(3 * 10000 + 5000); // 3 nights + cleaning
    expect(result.nightly).toEqual([
      { date: "2026-03-15", cents: 10000 },
      { date: "2026-03-16", cents: 10000 },
      { date: "2026-03-17", cents: 10000 },
    ]);
  });

  it("handles stay crossing seasonal boundary", () => {
    const aptWithRate: AptInput = {
      ...apt,
      rates: [
        {
          startYmd: "2026-03-01",
          endYmd: "2026-03-15",
          nightlyCents: 10000,
          minNights: null,
          createdAt: new Date("2026-01-01"),
        },
        {
          startYmd: "2026-03-16",
          endYmd: "2026-03-31",
          nightlyCents: 15000,
          minNights: null,
          createdAt: new Date("2026-01-01"),
        },
      ],
    };
    const result = evaluateApartment(aptWithRate, [], {
      inYmd: "2026-03-14",
      outYmd: "2026-03-18",
      guests: 2,
      today: "2026-03-12",
      now,
    });
    expect(result.available).toBe(true);
    // March 14, 15 in first rate (10000 each), March 16, 17 in second rate (15000 each)
    expect(result.totalCents).toBe(10000 + 10000 + 15000 + 15000 + 5000); // mixed rates + cleaning
  });

  it("returns PAST_DATE for check-in in the past", () => {
    const result = evaluateApartment(apt, [], {
      inYmd: "2026-03-10",
      outYmd: "2026-03-13",
      guests: 2,
      today: "2026-03-12",
      now,
    });
    expect(result.available).toBe(false);
    expect(result.reason).toBe("PAST_DATE");
  });

  it("returns TOO_FAR for dates more than 730 days ahead", () => {
    const result = evaluateApartment(apt, [], {
      inYmd: "2028-03-15", // should be > 730 days from 2026-03-12
      outYmd: "2028-03-18",
      guests: 2,
      today: "2026-03-12",
      now,
    });
    expect(result.available).toBe(false);
    expect(result.reason).toBe("TOO_FAR");
  });

  it("allows dates within 730 days", () => {
    const result = evaluateApartment(apt, [], {
      inYmd: "2026-12-31", // should be within 730 days from 2026-03-12
      outYmd: "2027-01-03",
      guests: 2,
      today: "2026-03-12",
      now,
    });
    expect(result.available).toBe(true);
  });

  it("returns TOO_LONG for stays over 60 nights", () => {
    const result = evaluateApartment(apt, [], {
      inYmd: "2026-03-15",
      outYmd: "2026-05-20", // ~66 nights
      guests: 2,
      today: "2026-03-12",
      now,
    });
    expect(result.available).toBe(false);
    expect(result.reason).toBe("TOO_LONG");
  });

  it("allows exactly 60 nights", () => {
    const result = evaluateApartment(apt, [], {
      inYmd: "2026-03-15",
      outYmd: "2026-05-14", // 60 nights
      guests: 2,
      today: "2026-03-12",
      now,
    });
    expect(result.available).toBe(true);
  });

  it("returns TOO_MANY_GUESTS when guests exceed capacity", () => {
    const result = evaluateApartment(apt, [], {
      inYmd: "2026-03-15",
      outYmd: "2026-03-18",
      guests: 5,
      today: "2026-03-12",
      now,
    });
    expect(result.available).toBe(false);
    expect(result.reason).toBe("TOO_MANY_GUESTS");
  });

  it("returns MIN_NIGHTS when stay is too short", () => {
    const result = evaluateApartment(apt, [], {
      inYmd: "2026-03-15",
      outYmd: "2026-03-16", // 1 night, min is 2
      guests: 2,
      today: "2026-03-12",
      now,
    });
    expect(result.available).toBe(false);
    expect(result.reason).toBe("MIN_NIGHTS");
  });

  it("returns BOOKED when dates overlap with a booking", () => {
    const stays: StayRow[] = [
      { inYmd: "2026-03-16", outYmd: "2026-03-19" },
    ];
    const result = evaluateApartment(apt, stays, {
      inYmd: "2026-03-15",
      outYmd: "2026-03-18",
      guests: 2,
      today: "2026-03-12",
      now,
    });
    expect(result.available).toBe(false);
    expect(result.reason).toBe("BOOKED");
  });

  it("allows back-to-back stays (check-out equals check-in)", () => {
    const stays: StayRow[] = [
      { inYmd: "2026-03-13", outYmd: "2026-03-15" },
    ];
    const result = evaluateApartment(apt, stays, {
      inYmd: "2026-03-15",
      outYmd: "2026-03-18",
      guests: 2,
      today: "2026-03-12",
      now,
    });
    expect(result.available).toBe(true);
  });

  it("returns BOOKED when overlapping by one night", () => {
    const stays: StayRow[] = [
      { inYmd: "2026-03-13", outYmd: "2026-03-16" },
    ];
    const result = evaluateApartment(apt, stays, {
      inYmd: "2026-03-15",
      outYmd: "2026-03-18",
      guests: 2,
      today: "2026-03-12",
      now,
    });
    expect(result.available).toBe(false);
    expect(result.reason).toBe("BOOKED");
  });

  it("returns BOOKED when a block exists", () => {
    const stays: StayRow[] = [
      { inYmd: "2026-03-15", outYmd: "2026-03-18" },
    ];
    const result = evaluateApartment(apt, stays, {
      inYmd: "2026-03-15",
      outYmd: "2026-03-18",
      guests: 2,
      today: "2026-03-12",
      now,
    });
    expect(result.available).toBe(false);
    expect(result.reason).toBe("BOOKED");
  });

  it("returns CALENDAR_UNVERIFIED when feed is stale", () => {
    const aptWithFeed: AptInput = {
      ...apt,
      feeds: [
        {
          lastSuccessAt: new Date(now.getTime() - 4 * 3_600_000), // 4 hours ago
          lastError: null,
        },
      ],
    };
    const result = evaluateApartment(aptWithFeed, [], {
      inYmd: "2026-03-15",
      outYmd: "2026-03-18",
      guests: 2,
      today: "2026-03-12",
      now,
    });
    expect(result.available).toBe(false);
    expect(result.reason).toBe("CALENDAR_UNVERIFIED");
  });

  it("returns CALENDAR_UNVERIFIED when feed has error", () => {
    const aptWithFeed: AptInput = {
      ...apt,
      feeds: [
        {
          lastSuccessAt: new Date(now.getTime() - 2_000_000),
          lastError: "Sync failed",
        },
      ],
    };
    const result = evaluateApartment(aptWithFeed, [], {
      inYmd: "2026-03-15",
      outYmd: "2026-03-18",
      guests: 2,
      today: "2026-03-12",
      now,
    });
    expect(result.available).toBe(false);
    expect(result.reason).toBe("CALENDAR_UNVERIFIED");
  });

  it("applies rate minNights from check-in night only", () => {
    const aptWithRate: AptInput = {
      ...apt,
      rates: [
        {
          startYmd: "2026-03-15",
          endYmd: "2026-03-20",
          nightlyCents: 15000,
          minNights: 5,
          createdAt: new Date("2026-01-01"),
        },
      ],
    };
    const result = evaluateApartment(aptWithRate, [], {
      inYmd: "2026-03-15",
      outYmd: "2026-03-18", // 3 nights, but rate requires 5
      guests: 2,
      today: "2026-03-12",
      now,
    });
    expect(result.available).toBe(false);
    expect(result.reason).toBe("MIN_NIGHTS");
  });

  it("reports BOOKED even when unverified if booking exists", () => {
    const aptWithFeed: AptInput = {
      ...apt,
      feeds: [
        {
          lastSuccessAt: new Date(now.getTime() - 4_000_000),
          lastError: null,
        },
      ],
    };
    const stays: StayRow[] = [
      { inYmd: "2026-03-15", outYmd: "2026-03-18" },
    ];
    const result = evaluateApartment(aptWithFeed, stays, {
      inYmd: "2026-03-15",
      outYmd: "2026-03-18",
      guests: 2,
      today: "2026-03-12",
      now,
    });
    expect(result.available).toBe(false);
    expect(result.reason).toBe("BOOKED");
  });

  it("returns NO_PRICE when rate has zero or negative price", () => {
    const aptWithZeroRate: AptInput = {
      ...apt,
      rates: [
        {
          startYmd: "2026-03-01",
          endYmd: "2026-03-31",
          nightlyCents: 0,
          minNights: null,
          createdAt: new Date("2026-01-01"),
        },
      ],
    };
    const result = evaluateApartment(aptWithZeroRate, [], {
      inYmd: "2026-03-15",
      outYmd: "2026-03-18",
      guests: 2,
      today: "2026-03-12",
      now,
    });
    expect(result.available).toBe(false);
    expect(result.reason).toBe("NO_PRICE");
  });

  it("returns NO_PRICE when base price is zero", () => {
    const aptWithZeroBase: AptInput = {
      ...apt,
      baseNightlyCents: 0,
    };
    const result = evaluateApartment(aptWithZeroBase, [], {
      inYmd: "2026-03-15",
      outYmd: "2026-03-18",
      guests: 2,
      today: "2026-03-12",
      now,
    });
    expect(result.available).toBe(false);
    expect(result.reason).toBe("NO_PRICE");
  });
});

describe("reasonToText", () => {
  it("returns plain text for each reason", () => {
    expect(reasonToText("PAST_DATE")).toBe("Date in the past");
    expect(reasonToText("TOO_FAR")).toBe("Date too far ahead (more than 2 years)");
    expect(reasonToText("TOO_LONG")).toBe("Stay too long (maximum 60 nights)");
    expect(reasonToText("TOO_MANY_GUESTS")).toBe("Too many guests for this apartment");
    expect(reasonToText("MIN_NIGHTS")).toBe("Minimum stay requirement not met");
    expect(reasonToText("BOOKED")).toBe("Already booked");
    expect(reasonToText("NO_PRICE")).toBe("Price not set for these dates");
    expect(reasonToText("CALENDAR_UNVERIFIED")).toBe("Calendar not recently synchronized");
  });
});

describe("shiftedWindows", () => {
  const apt: AptInput = {
    id: "apt1",
    name: "Apartment 1",
    maxGuests: 4,
    bedrooms: 2,
    minNights: 2,
    baseNightlyCents: 10000,
    cleaningFeeCents: 5000,
    rates: [],
    feeds: [],
  };
  const now = new Date("2026-03-12T12:00:00Z");

  it("returns nearest windows first", () => {
    const result = shiftedWindows(apt, [], {
      inYmd: "2026-03-15",
      outYmd: "2026-03-18",
      guests: 2,
      today: "2026-03-12",
      now,
    });
    expect(result.length).toBeGreaterThan(0);
    // First result should be the nearest shift
    expect(result[0].inYmd).toBe("2026-03-14"); // -1 day
  });

  it("returns same length stays", () => {
    const result = shiftedWindows(apt, [], {
      inYmd: "2026-03-15",
      outYmd: "2026-03-18",
      guests: 2,
      today: "2026-03-12",
      now,
    });
    for (const w of result) {
      const nights = Math.round(
        (Date.parse(`${w.outYmd}T00:00:00Z`) - Date.parse(`${w.inYmd}T00:00:00Z`)) / 86_400_000,
      );
      expect(nights).toBe(3);
    }
  });

  it("limits to 3 results", () => {
    const result = shiftedWindows(apt, [], {
      inYmd: "2026-03-15",
      outYmd: "2026-03-18",
      guests: 2,
      today: "2026-03-12",
      now,
    });
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("skips booked windows", () => {
    const stays: StayRow[] = [
      { inYmd: "2026-03-14", outYmd: "2026-03-17" },
    ];
    const result = shiftedWindows(apt, stays, {
      inYmd: "2026-03-15",
      outYmd: "2026-03-18",
      guests: 2,
      today: "2026-03-12",
      now,
    });
    // Should not include the -1 day shift (2026-03-14 to 2026-03-17)
    expect(result.every((w) => w.inYmd !== "2026-03-14")).toBe(true);
  });

  it("skips unverified windows", () => {
    const aptWithFeed: AptInput = {
      ...apt,
      feeds: [
        {
          lastSuccessAt: new Date(now.getTime() - 4 * 3_600_000), // 4 hours ago
          lastError: null,
        },
      ],
    };
    const result = shiftedWindows(aptWithFeed, [], {
      inYmd: "2026-03-15",
      outYmd: "2026-03-18",
      guests: 2,
      today: "2026-03-12",
      now,
    });
    expect(result.length).toBe(0);
  });
});
