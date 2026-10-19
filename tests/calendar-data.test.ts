import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { loadStays, loadCalendarData } from "@/lib/calendar-data";
import { maltaLocalToUtc, maltaYmd } from "@/lib/time";
import bcrypt from "bcryptjs";

describe("calendar-data", () => {
  vi.setConfig({ testTimeout: 10000 });
  let ownerA: { id: string };
  let ownerB: { id: string };
  let apartmentA: { id: string };
  let apartmentB: { id: string };

  beforeEach(async () => {
    // Clean up database - delete all data first (simplest approach for test isolation)
    await prisma.booking.deleteMany();
    await prisma.calendarFeed.deleteMany();
    await prisma.apartment.deleteMany();
    await prisma.owner.deleteMany();

    // Create two owners
    const passwordHash = await bcrypt.hash("password123", 10);
    ownerA = await prisma.owner.create({
      data: {
        email: "ownerA@test.com",
        passwordHash,
        hostLanguage: "en",
        defaultGuestLanguage: "en",
      },
    });

    ownerB = await prisma.owner.create({
      data: {
        email: "ownerB@test.com",
        passwordHash,
        hostLanguage: "en",
        defaultGuestLanguage: "en",
      },
    });

    // Create apartments for owner A
    apartmentA = await prisma.apartment.create({
      data: {
        ownerId: ownerA.id,
        name: "Apartment A",
        address: "123 Street A",
        checkInTime: "15:00",
        checkOutTime: "11:00",
        maxGuests: 2,
        bedrooms: 1,
        minNights: 1,
        baseNightlyCents: 10000,
        cleaningFeeCents: 5000,
        info: "",
        publicInfo: "",
      },
    });

    apartmentB = await prisma.apartment.create({
      data: {
        ownerId: ownerA.id,
        name: "Apartment B",
        address: "456 Street B",
        checkInTime: "14:00",
        checkOutTime: "10:00",
        maxGuests: 2,
        bedrooms: 1,
        minNights: 1,
        baseNightlyCents: 10000,
        cleaningFeeCents: 5000,
        info: "",
        publicInfo: "",
      },
    });
  });

  describe("loadStays", () => {
    it("returns only the owner's bookings", async () => {
      // Create a booking for owner A
      await prisma.booking.create({
        data: {
          apartmentId: apartmentA.id,
          source: "AIRBNB",
          status: "CONFIRMED",
          checkIn: maltaLocalToUtc("2026-11-01", "15:00"),
          checkOut: maltaLocalToUtc("2026-11-04", "11:00"),
          guestName: "Guest A",
        },
      });

      // Create an apartment and booking for owner B
      const apartmentB1 = await prisma.apartment.create({
        data: {
          ownerId: ownerB.id,
          name: "Apartment B1",
          address: "789 Street B1",
          checkInTime: "15:00",
          checkOutTime: "11:00",
          maxGuests: 2,
          bedrooms: 1,
          minNights: 1,
          baseNightlyCents: 10000,
          cleaningFeeCents: 5000,
          info: "",
          publicInfo: "",
        },
      });

      await prisma.booking.create({
        data: {
          apartmentId: apartmentB1.id,
          source: "BOOKING_COM",
          status: "CONFIRMED",
          checkIn: maltaLocalToUtc("2026-11-02", "14:00"),
          checkOut: maltaLocalToUtc("2026-11-05", "10:00"),
          guestName: "Guest B",
        },
      });

      const stays = await loadStays(ownerA.id, "2026-11-01", "2026-11-07");
      expect(stays).toHaveLength(1);
      expect(stays[0].guestName).toBe("Guest A");
    });

    it("hides CANCELLED bookings", async () => {
      await prisma.booking.create({
        data: {
          apartmentId: apartmentA.id,
          source: "AIRBNB",
          status: "CANCELLED",
          checkIn: maltaLocalToUtc("2026-11-01", "15:00"),
          checkOut: maltaLocalToUtc("2026-11-04", "11:00"),
          guestName: "Cancelled Guest",
        },
      });

      await prisma.booking.create({
        data: {
          apartmentId: apartmentA.id,
          source: "AIRBNB",
          status: "CONFIRMED",
          checkIn: maltaLocalToUtc("2026-11-02", "15:00"),
          checkOut: maltaLocalToUtc("2026-11-05", "11:00"),
          guestName: "Confirmed Guest",
        },
      });

      const stays = await loadStays(ownerA.id, "2026-11-01", "2026-11-07");
      expect(stays).toHaveLength(1);
      expect(stays[0].guestName).toBe("Confirmed Guest");
    });

    it("includes a stay that checks out on the from day", async () => {
      await prisma.booking.create({
        data: {
          apartmentId: apartmentA.id,
          source: "AIRBNB",
          status: "CONFIRMED",
          checkIn: maltaLocalToUtc("2026-10-29", "15:00"),
          checkOut: maltaLocalToUtc("2026-11-01", "11:00"),
          guestName: "Guest",
        },
      });

      const stays = await loadStays(ownerA.id, "2026-11-01", "2026-11-07");
      expect(stays).toHaveLength(1);
      expect(stays[0].outYmd).toBe("2026-11-01");
    });

    it("excludes a stay that checks in on the to day", async () => {
      await prisma.booking.create({
        data: {
          apartmentId: apartmentA.id,
          source: "AIRBNB",
          status: "CONFIRMED",
          checkIn: maltaLocalToUtc("2026-11-07", "15:00"),
          checkOut: maltaLocalToUtc("2026-11-10", "11:00"),
          guestName: "Guest",
        },
      });

      const stays = await loadStays(ownerA.id, "2026-11-01", "2026-11-07");
      expect(stays).toHaveLength(0);
    });

    it("includes blocks", async () => {
      await prisma.booking.create({
        data: {
          apartmentId: apartmentA.id,
          source: "AIRBNB",
          status: "CONFIRMED",
          checkIn: maltaLocalToUtc("2026-11-01", "15:00"),
          checkOut: maltaLocalToUtc("2026-11-04", "11:00"),
          isBlock: true,
        },
      });

      const stays = await loadStays(ownerA.id, "2026-11-01", "2026-11-07");
      expect(stays).toHaveLength(1);
      expect(stays[0].isBlock).toBe(true);
    });

    it("Malta date conversion is exact around daylight saving", async () => {
      // October clock change (last Sunday of October 2026 is Oct 25)
      const booking = await prisma.booking.create({
        data: {
          apartmentId: apartmentA.id,
          source: "AIRBNB",
          status: "CONFIRMED",
          checkIn: maltaLocalToUtc("2026-10-24", "15:00"),
          checkOut: maltaLocalToUtc("2026-10-27", "11:00"),
          guestName: "Guest",
        },
      });

      const stays = await loadStays(ownerA.id, "2026-10-24", "2026-10-28");
      expect(stays).toHaveLength(1);
      expect(stays[0].inYmd).toBe("2026-10-24");
      expect(stays[0].outYmd).toBe("2026-10-27");
    });
  });

  describe("loadCalendarData", () => {
    it("returns the owner's feeds only", async () => {
      // Create feed for owner A
      await prisma.calendarFeed.create({
        data: {
          apartmentId: apartmentA.id,
          source: "AIRBNB",
          icalUrl: "https://airbnb.com/ical.ics",
          lastSyncAt: new Date(),
          lastSuccessAt: new Date(),
        },
      });

      // Create apartment and feed for owner B
      const apartmentB1 = await prisma.apartment.create({
        data: {
          ownerId: ownerB.id,
          name: "Apartment B1",
          address: "789 Street B1",
          checkInTime: "15:00",
          checkOutTime: "11:00",
          maxGuests: 2,
          bedrooms: 1,
          minNights: 1,
          baseNightlyCents: 10000,
          cleaningFeeCents: 5000,
          info: "",
          publicInfo: "",
        },
      });

      await prisma.calendarFeed.create({
        data: {
          apartmentId: apartmentB1.id,
          source: "BOOKING_COM",
          icalUrl: "https://booking.com/ical.ics",
        },
      });

      const data = await loadCalendarData(ownerA.id, "2026-11-01", 14, "2026-11-01");
      expect(data.feeds).toHaveLength(1);
      expect(data.feeds[0].source).toBe("AIRBNB");
    });

    it("returns apartments, viewStays, upcomingStays, and feeds", async () => {
      await prisma.booking.create({
        data: {
          apartmentId: apartmentA.id,
          source: "AIRBNB",
          status: "CONFIRMED",
          checkIn: maltaLocalToUtc("2026-11-01", "15:00"),
          checkOut: maltaLocalToUtc("2026-11-04", "11:00"),
          guestName: "Guest",
        },
      });

      await prisma.calendarFeed.create({
        data: {
          apartmentId: apartmentA.id,
          source: "AIRBNB",
          icalUrl: "https://airbnb.com/ical.ics",
        },
      });

      const data = await loadCalendarData(ownerA.id, "2026-11-01", 14, "2026-11-01");
      expect(data.apartments).toHaveLength(2);
      expect(data.viewStays).toHaveLength(1);
      expect(data.upcomingStays).toHaveLength(1);
      expect(data.feeds).toHaveLength(1);
    });
  });
});
