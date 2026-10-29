/**
 * Shared test helpers for database setup and cleanup
 * All database tests should use these helpers to ensure proper isolation
 */

import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";

/**
 * Clean up all test data in the correct order (children before parents)
 * Call this in beforeEach() hooks
 */
export async function cleanupDatabase() {
  // Delete in reverse dependency order to respect FK constraints
  await prisma.leadMessage.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.message.deleteMany();
  await prisma.scheduledMessage.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.calendarFeed.deleteMany();
  await prisma.exportFeed.deleteMany();
  await prisma.rate.deleteMany();
  await prisma.apartment.deleteMany();
  await prisma.messageTemplate.deleteMany();
  await prisma.templateTranslation.deleteMany();
  await prisma.unmatchedMessage.deleteMany();
  await prisma.optOut.deleteMany();
  await prisma.loginAttempt.deleteMany();
  await prisma.jobRun.deleteMany();
  await prisma.usageDaily.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.owner.deleteMany();
}

/**
 * Create a test owner with unique email based on test context
 * Use a timestamp to ensure uniqueness across test runs
 * @param email - Base email (will be made unique with timestamp)
 * @param overrides - Additional owner fields to override (can include passwordHash for auth tests)
 */
export async function createTestOwner(email: string, overrides = {}) {
  const timestamp = Date.now();
  const uniqueEmail = `${email.replace("@", `+${timestamp}@`)}`;
  const passwordHash = await bcrypt.hash("password123", 12); // Match production cost
  return prisma.owner.create({
    data: {
      email: uniqueEmail,
      passwordHash,
      hostLanguage: "en",
      defaultGuestLanguage: "en",
      fallbackLanguage: "en",
      ...overrides,
    },
  });
}

/**
 * Create a test apartment for an owner
 */
export async function createTestApartment(ownerId: string, overrides = {}) {
  return prisma.apartment.create({
    data: {
      ownerId,
      name: "Test Apartment",
      address: "123 Test St",
      checkInTime: "15:00",
      checkOutTime: "11:00",
      maxGuests: 2,
      bedrooms: 1,
      minNights: 1,
      baseNightlyCents: 10000,
      cleaningFeeCents: 5000,
      info: "",
      publicInfo: "",
      ...overrides,
    },
  });
}

/**
 * Create a test booking
 */
export async function createTestBooking(apartmentId: string, overrides = {}) {
  return prisma.booking.create({
    data: {
      apartmentId,
      source: "DIRECT",
      status: "CONFIRMED",
      checkIn: new Date("2026-11-01T15:00:00Z"),
      checkOut: new Date("2026-11-05T11:00:00Z"),
      guestName: "Test Guest",
      ...overrides,
    },
  });
}

/**
 * Create a test calendar feed
 */
export async function createTestFeed(apartmentId: string, overrides = {}) {
  return prisma.calendarFeed.create({
    data: {
      apartmentId,
      source: "AIRBNB",
      icalUrl: "https://example.com/calendar.ics",
      ...overrides,
    },
  });
}
