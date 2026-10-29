import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";

// Mock auth module
vi.mock("@/lib/auth", () => ({
  requireOwner: vi.fn(),
}));

// Mock sync module to avoid actual sync calls in ownership tests
vi.mock("@/lib/sync", () => ({
  syncFeed: vi.fn(() => Promise.resolve({ ok: true, created: 0, updated: 0, cancelled: 0, feedId: "test" })),
}));

// Mock next/navigation
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

// Mock next/cache
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("Apartment ownership tests", () => {
  vi.setConfig({ testTimeout: 10000 });
  let ownerA: Awaited<ReturnType<typeof prisma.owner.create>>;
  let ownerB: Awaited<ReturnType<typeof prisma.owner.create>>;
  let apartmentA: { id: string };

  beforeEach(async () => {
    // Clean up database
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

    // Create an apartment for owner A
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
  });

  it("owner B cannot update owner A's apartment", async () => {
    const { requireOwner } = await import("@/lib/auth");
    vi.mocked(requireOwner).mockResolvedValue(ownerB);

    const { updateApartment } = await import("@/app/(app)/apartments/actions");

    const formData = new FormData();
    formData.set("name", "Hacked Name");
    formData.set("address", "Hacked Address");
    formData.set("checkInTime", "15:00");
    formData.set("checkOutTime", "11:00");
    formData.set("maxGuests", "5");
    formData.set("bedrooms", "3");
    formData.set("minNights", "1");
    formData.set("baseNightlyEuros", "500");
    formData.set("cleaningFeeEuros", "100");
    formData.set("info", "Hacked info");
    formData.set("publicInfo", "Hacked public info");

    await expect(updateApartment(apartmentA.id, undefined, formData)).rejects.toThrow("NOT_FOUND");

    // Verify apartment data is unchanged
    const apartment = await prisma.apartment.findUnique({
      where: { id: apartmentA.id },
    });
    expect(apartment?.name).toBe("Apartment A");
    expect(apartment?.address).toBe("123 Street A");
  });

  it("owner A can update their own apartment", async () => {
    const { requireOwner } = await import("@/lib/auth");
    vi.mocked(requireOwner).mockResolvedValue(ownerA);

    const { updateApartment } = await import("@/app/(app)/apartments/actions");

    const formData = new FormData();
    formData.set("name", "Updated Name");
    formData.set("address", "456 Updated Street");
    formData.set("checkInTime", "15:00");
    formData.set("checkOutTime", "11:00");
    formData.set("maxGuests", "4");
    formData.set("bedrooms", "2");
    formData.set("minNights", "2");
    formData.set("baseNightlyEuros", "150");
    formData.set("cleaningFeeEuros", "75");
    formData.set("info", "Updated info");
    formData.set("publicInfo", "Updated public info");

    const result = await updateApartment(apartmentA.id, undefined, formData);
    expect(result?.ok).toBe(true);

    // Verify apartment data is updated
    const apartment = await prisma.apartment.findUnique({
      where: { id: apartmentA.id },
    });
    expect(apartment?.name).toBe("Updated Name");
    expect(apartment?.address).toBe("456 Updated Street");
  });

  it("owner B cannot delete owner A's apartment", async () => {
    const { requireOwner } = await import("@/lib/auth");
    vi.mocked(requireOwner).mockResolvedValue(ownerB);

    const { deleteApartment } = await import("@/app/(app)/apartments/actions");

    await expect(deleteApartment(apartmentA.id)).rejects.toThrow("NOT_FOUND");

    // Verify apartment still exists
    const apartment = await prisma.apartment.findUnique({
      where: { id: apartmentA.id },
    });
    expect(apartment).not.toBeNull();
  });

  it("owner A can delete their own apartment", async () => {
    const { requireOwner } = await import("@/lib/auth");
    vi.mocked(requireOwner).mockResolvedValue(ownerA);

    const { deleteApartment } = await import("@/app/(app)/apartments/actions");

    await expect(deleteApartment(apartmentA.id)).rejects.toThrow("REDIRECT"); // redirect after delete

    // Verify apartment is deleted
    const apartment = await prisma.apartment.findUnique({
      where: { id: apartmentA.id },
    });
    expect(apartment).toBeNull();
  });

  it("owner B cannot add feed to owner A's apartment", async () => {
    const { requireOwner } = await import("@/lib/auth");
    vi.mocked(requireOwner).mockResolvedValue(ownerB);

    const { addFeed } = await import("@/app/(app)/apartments/actions");

    const formData = new FormData();
    formData.set("source", "AIRBNB");
    formData.set("icalUrl", "https://www.airbnb.com/calendar/ical/123.ics");

    await expect(addFeed(apartmentA.id, undefined, formData)).rejects.toThrow("NOT_FOUND");

    // Verify no feed was added
    const feeds = await prisma.calendarFeed.findMany({
      where: { apartmentId: apartmentA.id },
    });
    expect(feeds.length).toBe(0);
  });

  it("owner A can add feed to their apartment", async () => {
    const { requireOwner } = await import("@/lib/auth");
    vi.mocked(requireOwner).mockResolvedValue(ownerA);

    const { addFeed } = await import("@/app/(app)/apartments/actions");

    const formData = new FormData();
    formData.set("source", "AIRBNB");
    formData.set("icalUrl", "https://www.airbnb.com/calendar/ical/123.ics");

    const result = await addFeed(apartmentA.id, undefined, formData);
    expect(result?.ok).toBe(true);

    // Verify feed was added
    const feeds = await prisma.calendarFeed.findMany({
      where: { apartmentId: apartmentA.id },
    });
    expect(feeds.length).toBe(1);
    expect(feeds[0].source).toBe("AIRBNB");
  });

  it("owner B cannot remove feed from owner A's apartment", async () => {
    // First add a feed as owner A
    const feed = await prisma.calendarFeed.create({
      data: {
        apartmentId: apartmentA.id,
        source: "AIRBNB",
        icalUrl: "https://www.airbnb.com/calendar/ical/123.ics",
      },
    });

    const { requireOwner } = await import("@/lib/auth");
    vi.mocked(requireOwner).mockResolvedValue(ownerB);

    const { removeFeed } = await import("@/app/(app)/apartments/actions");

    await removeFeed(feed.id, apartmentA.id);

    // Verify feed still exists (no rows changed)
    const feeds = await prisma.calendarFeed.findMany({
      where: { apartmentId: apartmentA.id },
    });
    expect(feeds.length).toBe(1);
  });

  it("owner A can remove feed from their apartment", async () => {
    // First add a feed
    const feed = await prisma.calendarFeed.create({
      data: {
        apartmentId: apartmentA.id,
        source: "AIRBNB",
        icalUrl: "https://www.airbnb.com/calendar/ical/123.ics",
      },
    });

    const { requireOwner } = await import("@/lib/auth");
    vi.mocked(requireOwner).mockResolvedValue(ownerA);

    const { removeFeed } = await import("@/app/(app)/apartments/actions");

    await removeFeed(feed.id, apartmentA.id);

    // Verify feed was removed
    const feeds = await prisma.calendarFeed.findMany({
      where: { apartmentId: apartmentA.id },
    });
    expect(feeds.length).toBe(0);
  });

  it("rejects adding a 6th feed (max 5 per apartment)", async () => {
    // Add 5 feeds
    for (let i = 0; i < 5; i++) {
      await prisma.calendarFeed.create({
        data: {
          apartmentId: apartmentA.id,
          source: "AIRBNB",
          icalUrl: `https://www.airbnb.com/calendar/ical/${i}.ics`,
        },
      });
    }

    const { requireOwner } = await import("@/lib/auth");
    vi.mocked(requireOwner).mockResolvedValue(ownerA);

    const { addFeed } = await import("@/app/(app)/apartments/actions");

    const formData = new FormData();
    formData.set("source", "AIRBNB");
    formData.set("icalUrl", "https://www.airbnb.com/calendar/ical/123.ics");

    const result = await addFeed(apartmentA.id, undefined, formData);
    expect(result?.error).toBe("Maximum 5 calendar links per apartment.");
  });

  it("rejects unsafe feed URLs", async () => {
    const { requireOwner } = await import("@/lib/auth");
    vi.mocked(requireOwner).mockResolvedValue(ownerA);

    const { addFeed } = await import("@/app/(app)/apartments/actions");

    const formData = new FormData();
    formData.set("source", "AIRBNB");
    formData.set("icalUrl", "http://example.com/calendar.ics");

    const result = await addFeed(apartmentA.id, undefined, formData);
    expect(result?.fieldErrors?.icalUrl).toBeDefined();
  });

  it("apartment form preserves typed values on validation error", async () => {
    const { requireOwner } = await import("@/lib/auth");
    vi.mocked(requireOwner).mockResolvedValue(ownerA);

    const { updateApartment } = await import("@/app/(app)/apartments/actions");

    const formData = new FormData();
    formData.set("name", "Typed Name");
    formData.set("address", "Typed Address");
    formData.set("checkInTime", "25:00"); // Invalid time
    formData.set("checkOutTime", "11:00");
    formData.set("maxGuests", "4");
    formData.set("bedrooms", "2");
    formData.set("minNights", "2");
    formData.set("baseNightlyEuros", "150");
    formData.set("cleaningFeeEuros", "75");
    formData.set("info", "Typed info");
    formData.set("publicInfo", "Typed public info");

    const result = await updateApartment(apartmentA.id, undefined, formData);
    expect(result?.ok).toBeUndefined();
    expect(result?.fieldErrors?.checkInTime).toBeDefined();
    expect(result?.submitted?.name).toBe("Typed Name");
    expect(result?.submitted?.address).toBe("Typed Address");
    expect(result?.submitted?.info).toBe("Typed info");
  });
});
