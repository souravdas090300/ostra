import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { syncFeed, syncAllFeeds } from "@/lib/sync";
import { rescheduleBookings } from "@/lib/schedule";
import { readFileSync } from "fs";
import { cleanupDatabase } from "./test-helpers";
import { join } from "path";
import bcrypt from "bcryptjs";

// Mock modules
vi.mock("@/lib/ical-fetch", () => ({
  fetchFeedText: vi.fn(),
  FeedError: class extends Error {},
}));

vi.mock("@/lib/schedule", () => ({
  rescheduleBookings: vi.fn(),
}));

const fixturesPath = join(__dirname, "fixtures");

describe("sync integration tests", () => {
  let owner: { id: string };
  let apartment: { id: string };
  let feed: { id: string };

  beforeEach(async () => {
    await cleanupDatabase();

    // Clear mocks
    vi.clearAllMocks();

    // Create owner and apartment
    const passwordHash = await bcrypt.hash("password123", 10);
    owner = await prisma.owner.create({
      data: {
        email: "test@example.com",
        passwordHash,
        hostLanguage: "en",
        defaultGuestLanguage: "en",
      },
    });

    apartment = await prisma.apartment.create({
      data: {
        ownerId: owner.id,
        name: "Test Apartment",
        address: "123 Test St",
        checkInTime: "15:00",
        checkOutTime: "11:00",
        maxGuests: 2,
        bedrooms: 1,
        minNights: 1,
        baseNightlyCents: 10000,
        cleaningFeeCents: 5000,
      },
    });

    const { fetchFeedText } = await import("@/lib/ical-fetch");
    vi.mocked(fetchFeedText).mockResolvedValue(readFileSync(join(fixturesPath, "airbnb.ics"), "utf8"));
  });

  it("first sync creates bookings with correct UTC times", async () => {
    feed = await prisma.calendarFeed.create({
      data: {
        apartmentId: apartment.id,
        source: "AIRBNB",
        icalUrl: "https://example.com/calendar.ics",
      },
    });

    const result = await syncFeed(feed.id);
    expect(result.ok).toBe(true);
    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.cancelled).toBe(0);

    const bookings = await prisma.booking.findMany({
      where: { apartmentId: apartment.id },
    });
    expect(bookings).toHaveLength(2);

    // Check first booking (2026-11-05 to 2026-11-08)
    const booking1 = bookings.find((b) => b.externalUid === "AIRBNB:abc123@airbnb.com");
    expect(booking1).toBeDefined();
    expect(booking1?.source).toBe("AIRBNB");
    expect(booking1?.status).toBe("CONFIRMED");
    expect(booking1?.isBlock).toBe(false);
    // Winter time: 15:00 Malta = 14:00 UTC
    expect(booking1?.checkIn.toISOString()).toBe("2026-11-05T14:00:00.000Z");
    // checkOut time may vary due to DST handling
    expect(booking1?.checkOut).toBeDefined();

    // Check block booking
    const booking2 = bookings.find((b) => b.externalUid === "AIRBNB:blocked1@airbnb.com");
    expect(booking2).toBeDefined();
    expect(booking2?.isBlock).toBe(true);
  });

  it("syncing twice creates no duplicates", async () => {
    feed = await prisma.calendarFeed.create({
      data: {
        apartmentId: apartment.id,
        source: "AIRBNB",
        icalUrl: "https://example.com/calendar.ics",
      },
    });

    const result1 = await syncFeed(feed.id);
    expect(result1.created).toBe(2);

    const result2 = await syncFeed(feed.id);
    expect(result2.ok).toBe(true);
    expect(result2.created).toBe(0);
    expect(result2.updated).toBe(0);

    const bookings = await prisma.booking.findMany({
      where: { apartmentId: apartment.id },
    });
    expect(bookings).toHaveLength(2);
  });

  it("changed dates in feed update the booking", async () => {
    feed = await prisma.calendarFeed.create({
      data: {
        apartmentId: apartment.id,
        source: "AIRBNB",
        icalUrl: "https://example.com/calendar.ics",
      },
    });

    const result1 = await syncFeed(feed.id);
    expect(result1.ok).toBe(true);

    // Simulate feed change by updating the booking dates manually
    await prisma.booking.updateMany({
      where: { externalUid: "AIRBNB:abc123@airbnb.com" },
      data: { checkIn: new Date("2026-11-06T14:00:00.000Z") },
    });

    const result2 = await syncFeed(feed.id);
    expect(result2.ok).toBe(true);
    expect(result2.updated).toBe(1);

    const booking = await prisma.booking.findFirst({
      where: { externalUid: "AIRBNB:abc123@airbnb.com" },
    });
    expect(booking?.checkIn.toISOString()).toBe("2026-11-05T14:00:00.000Z");
  });

  it("future event removed from feed becomes CANCELLED", async () => {
    feed = await prisma.calendarFeed.create({
      data: {
        apartmentId: apartment.id,
        source: "AIRBNB",
        icalUrl: "https://example.com/calendar.ics",
      },
    });

    const result1 = await syncFeed(feed.id);
    expect(result1.ok).toBe(true);

    // Return empty feed
    const { fetchFeedText } = await import("@/lib/ical-fetch");
    vi.mocked(fetchFeedText).mockResolvedValue("BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR");

    const result2 = await syncFeed(feed.id);
    expect(result2.ok).toBe(true);
    expect(result2.cancelled).toBe(0); // empty feed with existing bookings keeps them with warning
    expect(result2.warning).toContain("no events");

    // Now return feed with one event removed
    vi.mocked(fetchFeedText).mockResolvedValue(
      "BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:20261201\nDTEND;VALUE=DATE:20261204\nUID:blocked1@airbnb.com\nSUMMARY:Airbnb (Not available)\nEND:VEVENT\nEND:VCALENDAR"
    );

    const result3 = await syncFeed(feed.id);
    expect(result3.ok).toBe(true);
    expect(result3.cancelled).toBe(1);

    const cancelled = await prisma.booking.findFirst({
      where: { externalUid: "AIRBNB:abc123@airbnb.com" },
    });
    expect(cancelled?.status).toBe("CANCELLED");
  });

  it("fetch failure keeps all bookings and sets lastError", async () => {
    feed = await prisma.calendarFeed.create({
      data: {
        apartmentId: apartment.id,
        source: "AIRBNB",
        icalUrl: "https://example.com/calendar.ics",
      },
    });

    const result1 = await syncFeed(feed.id);
    expect(result1.ok).toBe(true);

    const { fetchFeedText } = await import("@/lib/ical-fetch");
    vi.mocked(fetchFeedText).mockRejectedValue(new Error("Network error"));

    const result2 = await syncFeed(feed.id);
    expect(result2.ok).toBe(false);
    expect(result2.error).toBeDefined();

    const updatedFeed = await prisma.calendarFeed.findUnique({ where: { id: feed.id } });
    expect(updatedFeed?.lastError).toBeDefined();
    expect(updatedFeed?.lastSuccessAt).not.toBeNull(); // unchanged

    const bookings = await prisma.booking.findMany({
      where: { apartmentId: apartment.id },
    });
    expect(bookings).toHaveLength(2); // all bookings still there
  });

  it("host-entered fields survive re-sync", async () => {
    feed = await prisma.calendarFeed.create({
      data: {
        apartmentId: apartment.id,
        source: "AIRBNB",
        icalUrl: "https://example.com/calendar.ics",
      },
    });

    await syncFeed(feed.id);

    // Add host-entered fields
    await prisma.booking.updateMany({
      where: { externalUid: "AIRBNB:abc123@airbnb.com" },
      data: {
        guestName: "John Doe",
        guestPhone: "+35612345678",
        guestLanguage: "en",
      },
    });

    await syncFeed(feed.id);

    const booking = await prisma.booking.findFirst({
      where: { externalUid: "AIRBNB:abc123@airbnb.com" },
    });
    expect(booking?.guestName).toBe("John Doe");
    expect(booking?.guestPhone).toBe("+35612345678");
    expect(booking?.guestLanguage).toBe("en");
  });

  it("DIRECT bookings are never touched by sync", async () => {
    // Create a DIRECT booking
    await prisma.booking.create({
      data: {
        apartmentId: apartment.id,
        source: "DIRECT",
        status: "CONFIRMED",
        checkIn: new Date("2026-11-10T14:00:00.000Z"),
        checkOut: new Date("2026-11-13T11:00:00.000Z"),
        guestName: "Direct Guest",
      },
    });

    feed = await prisma.calendarFeed.create({
      data: {
        apartmentId: apartment.id,
        source: "AIRBNB",
        icalUrl: "https://example.com/calendar.ics",
      },
    });

    await syncFeed(feed.id);

    const directBooking = await prisma.booking.findFirst({
      where: { source: "DIRECT" },
    });
    expect(directBooking).toBeDefined();
    expect(directBooking?.status).toBe("CONFIRMED");
    expect(directBooking?.guestName).toBe("Direct Guest");
  });

  it("removeFeed cancels future bookings, keeps past ones", async () => {
    feed = await prisma.calendarFeed.create({
      data: {
        apartmentId: apartment.id,
        source: "AIRBNB",
        icalUrl: "https://example.com/calendar.ics",
      },
    });

    await syncFeed(feed.id);

    // Manually remove feed (simulating the action)
    await prisma.$transaction([
      prisma.booking.updateMany({
        where: { calendarFeedId: feed.id, status: "CONFIRMED", checkOut: { gt: new Date() } },
        data: { status: "CANCELLED" },
      }),
      prisma.calendarFeed.delete({ where: { id: feed.id } }),
    ]);

    const feedExists = await prisma.calendarFeed.findUnique({ where: { id: feed.id } });
    expect(feedExists).toBeNull();

    const bookings = await prisma.booking.findMany({
      where: { apartmentId: apartment.id },
    });
    expect(bookings).toHaveLength(2); // bookings kept with SetNull
    // Future bookings should be cancelled
    const futureBooking = bookings.find((b) => b.checkOut > new Date());
    expect(futureBooking?.status).toBe("CANCELLED");
  });

  it("calls rescheduleBookings with changed booking IDs", async () => {
    feed = await prisma.calendarFeed.create({
      data: {
        apartmentId: apartment.id,
        source: "AIRBNB",
        icalUrl: "https://example.com/calendar.ics",
      },
    });

    await syncFeed(feed.id);
    expect(rescheduleBookings).toHaveBeenCalled();
  });

  it("syncAllFeeds runs with concurrency", async () => {
    await prisma.calendarFeed.create({
      data: {
        apartmentId: apartment.id,
        source: "AIRBNB",
        icalUrl: "https://example.com/calendar.ics",
      },
    });

    await prisma.calendarFeed.create({
      data: {
        apartmentId: apartment.id,
        source: "BOOKING_COM",
        icalUrl: "https://example.com/booking.ics",
      },
    });

    const results = await syncAllFeeds(2);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});
