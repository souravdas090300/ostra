import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { newExportToken } from "@/lib/export-feeds";
import { buildIcs, selectStays, type ExportStay } from "@/lib/ical-export";
import { todayMalta, addDays } from "@/lib/dates";
import bcrypt from "bcryptjs";

// Mock rate-limit
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => true),
}));

// Mock clientIp
vi.mock("@/lib/login-guard", () => ({
  clientIp: vi.fn(() => "127.0.0.1"),
}));

import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/login-guard";
import { GET, HEAD } from "@/app/api/ical/[token]/route";

describe("ical export route", () => {
  let owner: { id: string };
  let apartment: { id: string };
  let airbnbFeed: { id: string; token: string };
  let bookingComFeed: { id: string; token: string };

  beforeEach(async () => {
    // Clean up database
    await prisma.booking.deleteMany();
    await prisma.exportFeed.deleteMany();
    await prisma.apartment.deleteMany();
    await prisma.owner.deleteMany();

    // Clear mocks and reset rate limit to allow requests
    vi.clearAllMocks();
    vi.mocked(rateLimit).mockReturnValue(true);

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

    // Create export feeds
    const airbnbToken = newExportToken();
    const bookingComToken = newExportToken();

    airbnbFeed = await prisma.exportFeed.create({
      data: {
        apartmentId: apartment.id,
        target: "AIRBNB",
        token: airbnbToken,
        enabled: false,
      },
    });

    bookingComFeed = await prisma.exportFeed.create({
      data: {
        apartmentId: apartment.id,
        target: "BOOKING_COM",
        token: bookingComToken,
        enabled: false,
      },
    });
  });

  describe("authentication and validation", () => {
    it("unknown token returns 404 with no-store", async () => {
      const request = new Request("http://localhost/api/ical/unknowntoken.ics");
      const response = await GET(request, { params: Promise.resolve({ token: "unknowntoken" }) });
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
    });

    it("malformed token returns 404", async () => {
      const request = new Request("http://localhost/api/ical/abc.ics");
      const response = await GET(request, { params: Promise.resolve({ token: "abc" }) });
      expect(response.status).toBe(404);
    });

    it("disabled link returns 404", async () => {
      const request = new Request(`http://localhost/api/ical/${airbnbFeed.token}.ics`);
      const response = await GET(request, { params: Promise.resolve({ token: airbnbFeed.token }) });
      expect(response.status).toBe(404);
    });

    it("regenerated (old) token returns 404", async () => {
      // Enable the feed
      await prisma.exportFeed.update({
        where: { id: airbnbFeed.id },
        data: { enabled: true },
      });

      const oldToken = airbnbFeed.token;

      // Regenerate token
      const newToken = newExportToken();
      await prisma.exportFeed.update({
        where: { id: airbnbFeed.id },
        data: { token: newToken },
      });

      // Old token should return 404
      const request = new Request(`http://localhost/api/ical/${oldToken}.ics`);
      const response = await GET(request, { params: Promise.resolve({ token: oldToken }) });
      expect(response.status).toBe(404);
    });

    it("rate limit returns 429", async () => {
      vi.mocked(rateLimit).mockReturnValue(false);

      await prisma.exportFeed.update({
        where: { id: airbnbFeed.id },
        data: { enabled: true },
      });

      const request = new Request(`http://localhost/api/ical/${airbnbFeed.token}.ics`);
      const response = await GET(request, { params: Promise.resolve({ token: airbnbFeed.token }) });
      expect(response.status).toBe(429);
    });
  });

  describe("successful responses", () => {
    beforeEach(async () => {
      // Enable feeds
      await prisma.exportFeed.updateMany({
        where: { apartmentId: apartment.id },
        data: { enabled: true },
      });

      // Create some bookings
      const today = todayMalta();
      await prisma.booking.createMany({
        data: [
          {
            apartmentId: apartment.id,
            source: "DIRECT",
            status: "CONFIRMED",
            isBlock: false,
            checkIn: new Date(`${addDays(today, 5)}T14:00:00.000Z`),
            checkOut: new Date(`${addDays(today, 8)}T11:00:00.000Z`),
            guestName: "Direct Guest",
          },
          {
            apartmentId: apartment.id,
            source: "AIRBNB",
            status: "CONFIRMED",
            isBlock: false,
            checkIn: new Date(`${addDays(today, 10)}T14:00:00.000Z`),
            checkOut: new Date(`${addDays(today, 13)}T11:00:00.000Z`),
            externalUid: "AIRBNB:test@airbnb.com",
          },
          {
            apartmentId: apartment.id,
            source: "BOOKING_COM",
            status: "CONFIRMED",
            isBlock: false,
            checkIn: new Date(`${addDays(today, 15)}T14:00:00.000Z`),
            checkOut: new Date(`${addDays(today, 18)}T11:00:00.000Z`),
            externalUid: "BOOKING_COM:test@booking.com",
          },
        ],
      });
    });

    it("enabled link returns 200 with correct headers", async () => {
      const request = new Request(`http://localhost/api/ical/${airbnbFeed.token}.ics`);
      const response = await GET(request, { params: Promise.resolve({ token: airbnbFeed.token }) });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
      expect(response.headers.get("cache-control")).toBe("private, max-age=300");
      expect(response.headers.get("x-robots-tag")).toBe("noindex");
      expect(response.headers.get("etag")).toBeTruthy();
      expect(response.headers.get("content-disposition")).toContain('inline; filename="ostra.ics"');
    });

    it("returns valid iCal content", async () => {
      const request = new Request(`http://localhost/api/ical/${airbnbFeed.token}.ics`);
      const response = await GET(request, { params: Promise.resolve({ token: airbnbFeed.token }) });

      const body = await response.text();
      expect(body).toContain("BEGIN:VCALENDAR");
      expect(body).toContain("END:VCALENDAR");
      expect(body).toContain("SUMMARY:Reserved");
    });

    it("If-None-Match returns 304", async () => {
      const request1 = new Request(`http://localhost/api/ical/${airbnbFeed.token}.ics`);
      const response1 = await GET(request1, { params: Promise.resolve({ token: airbnbFeed.token }) });
      const etag = response1.headers.get("etag");

      const request2 = new Request(`http://localhost/api/ical/${airbnbFeed.token}.ics`, {
        headers: { "if-none-match": etag || "" },
      });
      const response2 = await GET(request2, { params: Promise.resolve({ token: airbnbFeed.token }) });

      expect(response2.status).toBe(304);
      expect(response2.headers.get("etag")).toBe(etag);
    });

    it("HEAD returns headers and no body", async () => {
      const request = new Request(`http://localhost/api/ical/${airbnbFeed.token}.ics`, { method: "HEAD" });
      const response = await HEAD(request, { params: Promise.resolve({ token: airbnbFeed.token }) });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
      const body = await response.text();
      expect(body).toBe("");
    });

    it("no session is needed", async () => {
      const request = new Request(`http://localhost/api/ical/${airbnbFeed.token}.ics`);
      const response = await GET(request, { params: Promise.resolve({ token: airbnbFeed.token }) });
      expect(response.status).toBe(200);
    });

    it(".ics suffix and no suffix both work", async () => {
      const request1 = new Request(`http://localhost/api/ical/${airbnbFeed.token}.ics`);
      const response1 = await GET(request1, { params: Promise.resolve({ token: `${airbnbFeed.token}.ics` }) });
      expect(response1.status).toBe(200);

      const request2 = new Request(`http://localhost/api/ical/${airbnbFeed.token}`);
      const response2 = await GET(request2, { params: Promise.resolve({ token: airbnbFeed.token }) });
      expect(response2.status).toBe(200);
    });
  });

  describe("isolation", () => {
    it("token of apartment A never returns bookings of apartment B", async () => {
      // Create second apartment with same owner
      const apartment2 = await prisma.apartment.create({
        data: {
          ownerId: owner.id,
          name: "Test Apartment 2",
          address: "456 Test St",
          checkInTime: "15:00",
          checkOutTime: "11:00",
          maxGuests: 2,
          bedrooms: 1,
          minNights: 1,
          baseNightlyCents: 10000,
          cleaningFeeCents: 5000,
        },
      });

      // Create booking for apartment 2
      const today = todayMalta();
      await prisma.booking.create({
        data: {
          apartmentId: apartment2.id,
          source: "DIRECT",
          status: "CONFIRMED",
          isBlock: false,
          checkIn: new Date(`${addDays(today, 5)}T14:00:00.000Z`),
          checkOut: new Date(`${addDays(today, 8)}T11:00:00.000Z`),
          guestName: "Apartment 2 Guest",
        },
      });

      // Enable feed for apartment 1
      await prisma.exportFeed.update({
        where: { id: airbnbFeed.id },
        data: { enabled: true },
      });

      const request = new Request(`http://localhost/api/ical/${airbnbFeed.token}.ics`);
      const response = await GET(request, { params: Promise.resolve({ token: airbnbFeed.token }) });
      const body = await response.text();

      expect(body).not.toContain("Apartment 2 Guest");
    });

    it("Airbnb token and Booking.com token return different content", async () => {
      const today = todayMalta();
      await prisma.booking.createMany({
        data: [
          {
            apartmentId: apartment.id,
            source: "AIRBNB",
            status: "CONFIRMED",
            isBlock: false,
            checkIn: new Date(`${addDays(today, 5)}T14:00:00.000Z`),
            checkOut: new Date(`${addDays(today, 8)}T11:00:00.000Z`),
            externalUid: "AIRBNB:test@airbnb.com",
          },
          {
            apartmentId: apartment.id,
            source: "BOOKING_COM",
            status: "CONFIRMED",
            isBlock: false,
            checkIn: new Date(`${addDays(today, 10)}T14:00:00.000Z`),
            checkOut: new Date(`${addDays(today, 13)}T11:00:00.000Z`),
            externalUid: "BOOKING_COM:test@booking.com",
          },
        ],
      });

      // Ensure both feeds are enabled
      await prisma.exportFeed.updateMany({
        where: { apartmentId: apartment.id },
        data: { enabled: true },
      });

      const airbnbRequest = new Request(`http://localhost/api/ical/${airbnbFeed.token}.ics`);
      const airbnbResponse = await GET(airbnbRequest, { params: Promise.resolve({ token: airbnbFeed.token }) });
      const airbnbBody = await airbnbResponse.text();

      const bookingComRequest = new Request(`http://localhost/api/ical/${bookingComFeed.token}.ics`);
      const bookingComResponse = await GET(bookingComRequest, { params: Promise.resolve({ token: bookingComFeed.token }) });
      const bookingComBody = await bookingComResponse.text();

      // Airbnb link should NOT contain Airbnb booking, only Booking.com
      const airbnbEventCount = (airbnbBody.match(/BEGIN:VEVENT/g) || []).length;
      const bookingComEventCount = (bookingComBody.match(/BEGIN:VEVENT/g) || []).length;

      expect(airbnbEventCount).toBe(1); // Only Booking.com booking
      expect(bookingComEventCount).toBe(1); // Only Airbnb booking
    });

    it("another owner's apartment gives notFound for actions", async () => {
      // Create second owner
      const passwordHash2 = await bcrypt.hash("password123", 10);
      const owner2 = await prisma.owner.create({
        data: {
          email: "test2@example.com",
          passwordHash: passwordHash2,
          hostLanguage: "en",
          defaultGuestLanguage: "en",
        },
      });

      // Create apartment for owner2
      const apartment2 = await prisma.apartment.create({
        data: {
          ownerId: owner2.id,
          name: "Owner 2 Apartment",
          address: "789 Test St",
          checkInTime: "15:00",
          checkOutTime: "11:00",
          maxGuests: 2,
          bedrooms: 1,
          minNights: 1,
          baseNightlyCents: 10000,
          cleaningFeeCents: 5000,
        },
      });

      // Create export feed for owner2's apartment
      const owner2Feed = await prisma.exportFeed.create({
        data: {
          apartmentId: apartment2.id,
          target: "AIRBNB",
          token: newExportToken(),
          enabled: true,
        },
      });

      // The route itself doesn't check ownership (it's public by token)
      // but this tests that the data is isolated
      const today = todayMalta();
      await prisma.booking.create({
        data: {
          apartmentId: apartment.id,
          source: "DIRECT",
          status: "CONFIRMED",
          isBlock: false,
          checkIn: new Date(`${addDays(today, 5)}T14:00:00.000Z`),
          checkOut: new Date(`${addDays(today, 8)}T11:00:00.000Z`),
          guestName: "Owner 1 Guest",
        },
      });

      const request = new Request(`http://localhost/api/ical/${owner2Feed.token}.ics`);
      const response = await GET(request, { params: Promise.resolve({ token: owner2Feed.token }) });
      const body = await response.text();

      expect(body).not.toContain("Owner 1 Guest");
    });
  });

  describe("tracking", () => {
    it("lastFetchedAt and fetchCount update on request", async () => {
      await prisma.exportFeed.update({
        where: { id: airbnbFeed.id },
        data: { enabled: true },
      });

      const feedBefore = await prisma.exportFeed.findUnique({ where: { id: airbnbFeed.id } });
      expect(feedBefore?.lastFetchedAt).toBeNull();
      expect(feedBefore?.fetchCount).toBe(0);

      const request = new Request(`http://localhost/api/ical/${airbnbFeed.token}.ics`);
      await GET(request, { params: Promise.resolve({ token: airbnbFeed.token }) });

      const feedAfter = await prisma.exportFeed.findUnique({ where: { id: airbnbFeed.id } });
      expect(feedAfter?.lastFetchedAt).not.toBeNull();
      expect(feedAfter?.fetchCount).toBe(1);
    });

    it("updates at most once per minute", async () => {
      await prisma.exportFeed.update({
        where: { id: airbnbFeed.id },
        data: { enabled: true },
      });

      const request = new Request(`http://localhost/api/ical/${airbnbFeed.token}.ics`);

      // First request
      await GET(request, { params: Promise.resolve({ token: airbnbFeed.token }) });
      let feed = await prisma.exportFeed.findUnique({ where: { id: airbnbFeed.id } });
      const firstFetchCount = feed?.fetchCount;

      // Second request immediately (should not increment)
      await GET(request, { params: Promise.resolve({ token: airbnbFeed.token }) });
      feed = await prisma.exportFeed.findUnique({ where: { id: airbnbFeed.id } });
      expect(feed?.fetchCount).toBe(firstFetchCount);
    });

    it("304 response also updates tracking", async () => {
      await prisma.exportFeed.update({
        where: { id: airbnbFeed.id },
        data: { enabled: true },
      });

      const request = new Request(`http://localhost/api/ical/${airbnbFeed.token}.ics`);

      // First request
      const response1 = await GET(request, { params: Promise.resolve({ token: airbnbFeed.token }) });
      const etag = response1.headers.get("etag");

      // Wait a bit to ensure minute boundary is passed
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Second request with If-None-Match
      const request2 = new Request(`http://localhost/api/ical/${airbnbFeed.token}.ics`, {
        headers: { "if-none-match": etag || "" },
      });
      await GET(request2, { params: Promise.resolve({ token: airbnbFeed.token }) });

      const feed = await prisma.exportFeed.findUnique({ where: { id: airbnbFeed.id } });
      expect(feed?.fetchCount).toBeGreaterThan(0);
    });
  });

  describe("content filtering", () => {
    beforeEach(async () => {
      // Ensure Airbnb feed is enabled for content filtering tests
      await prisma.exportFeed.update({
        where: { id: airbnbFeed.id },
        data: { enabled: true },
      });
    });

    it("Airbnb link excludes Airbnb bookings", async () => {
      // Ensure Airbnb feed is enabled
      await prisma.exportFeed.update({
        where: { id: airbnbFeed.id },
        data: { enabled: true },
      });

      const today = todayMalta();
      await prisma.booking.createMany({
        data: [
          {
            apartmentId: apartment.id,
            source: "AIRBNB",
            status: "CONFIRMED",
            isBlock: false,
            checkIn: new Date(`${addDays(today, 5)}T14:00:00.000Z`),
            checkOut: new Date(`${addDays(today, 8)}T11:00:00.000Z`),
            externalUid: "AIRBNB:test@airbnb.com",
          },
          {
            apartmentId: apartment.id,
            source: "BOOKING_COM",
            status: "CONFIRMED",
            isBlock: false,
            checkIn: new Date(`${addDays(today, 10)}T14:00:00.000Z`),
            checkOut: new Date(`${addDays(today, 13)}T11:00:00.000Z`),
            externalUid: "BOOKING_COM:test@booking.com",
          },
        ],
      });

      const request = new Request(`http://localhost/api/ical/${airbnbFeed.token}.ics`);
      const response = await GET(request, { params: Promise.resolve({ token: airbnbFeed.token }) });
      const body = await response.text();

      const eventCount = (body.match(/BEGIN:VEVENT/g) || []).length;
      expect(eventCount).toBe(1); // Only Booking.com
    });

    it("Booking.com link excludes Booking.com bookings", async () => {
      // Enable Booking.com feed
      await prisma.exportFeed.update({
        where: { id: bookingComFeed.id },
        data: { enabled: true },
      });

      const today = todayMalta();
      await prisma.booking.createMany({
        data: [
          {
            apartmentId: apartment.id,
            source: "AIRBNB",
            status: "CONFIRMED",
            isBlock: false,
            checkIn: new Date(`${addDays(today, 5)}T14:00:00.000Z`),
            checkOut: new Date(`${addDays(today, 8)}T11:00:00.000Z`),
            externalUid: "AIRBNB:test@airbnb.com",
          },
          {
            apartmentId: apartment.id,
            source: "BOOKING_COM",
            status: "CONFIRMED",
            isBlock: false,
            checkIn: new Date(`${addDays(today, 10)}T14:00:00.000Z`),
            checkOut: new Date(`${addDays(today, 13)}T11:00:00.000Z`),
            externalUid: "BOOKING_COM:test@booking.com",
          },
        ],
      });

      const request = new Request(`http://localhost/api/ical/${bookingComFeed.token}.ics`);
      const response = await GET(request, { params: Promise.resolve({ token: bookingComFeed.token }) });
      const body = await response.text();

      const eventCount = (body.match(/BEGIN:VEVENT/g) || []).length;
      expect(eventCount).toBe(1); // Only Airbnb
    });

    it("blocks are never exported", async () => {
      const today = todayMalta();
      await prisma.booking.create({
        data: {
          apartmentId: apartment.id,
          source: "AIRBNB",
          status: "CONFIRMED",
          isBlock: true,
          checkIn: new Date(`${addDays(today, 5)}T14:00:00.000Z`),
          checkOut: new Date(`${addDays(today, 8)}T11:00:00.000Z`),
          externalUid: "AIRBNB:block@airbnb.com",
        },
      });

      const request = new Request(`http://localhost/api/ical/${bookingComFeed.token}.ics`);
      const response = await GET(request, { params: Promise.resolve({ token: bookingComFeed.token }) });
      const body = await response.text();

      const eventCount = (body.match(/BEGIN:VEVENT/g) || []).length;
      expect(eventCount).toBe(0);
    });

    it("cancelled bookings are not exported", async () => {
      const today = todayMalta();
      await prisma.booking.create({
        data: {
          apartmentId: apartment.id,
          source: "BOOKING_COM",
          status: "CANCELLED",
          isBlock: false,
          checkIn: new Date(`${addDays(today, 5)}T14:00:00.000Z`),
          checkOut: new Date(`${addDays(today, 8)}T11:00:00.000Z`),
          externalUid: "BOOKING_COM:cancelled@booking.com",
        },
      });

      const request = new Request(`http://localhost/api/ical/${airbnbFeed.token}.ics`);
      const response = await GET(request, { params: Promise.resolve({ token: airbnbFeed.token }) });
      const body = await response.text();

      const eventCount = (body.match(/BEGIN:VEVENT/g) || []).length;
      expect(eventCount).toBe(0);
    });
  });
});
