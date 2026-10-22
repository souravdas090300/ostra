#!/usr/bin/env node

/**
 * Account-level deletion script.
 * WARNING: This permanently deletes all guest data for an owner.
 * Use with extreme caution.
 * Usage: node scripts/delete-owner-data.mjs <owner-email> [--dry-run]
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");

  if (!email) {
    console.error("Usage: node scripts/delete-owner-data.mjs <owner-email> [--dry-run]");
    process.exit(1);
  }

  if (!dryRun) {
    console.warn("WARNING: This will permanently delete all guest data for this owner.");
    console.warn("Type 'DELETE' to confirm:");
    const confirmation = await new Promise((resolve) => {
      process.stdin.once("data", resolve);
    });
    if (confirmation.toString().trim() !== "DELETE") {
      console.log("Aborted");
      process.exit(0);
    }
  }

  const owner = await prisma.owner.findUnique({
    where: { email },
    include: {
      apartments: {
        include: {
          bookings: true,
        },
      },
      unmatched: true,
    },
  });

  if (!owner) {
    console.error(`Owner with email ${email} not found`);
    process.exit(1);
  }

  const bookingIds = owner.apartments.flatMap((apt) => apt.bookings.map((b) => b.id));

  console.log(`Found ${bookingIds.length} bookings and ${owner.unmatched.length} unmatched messages`);

  if (dryRun) {
    console.log("Dry run - no changes made");
    return;
  }

  const result = await prisma.$transaction([
    prisma.message.deleteMany({ where: { bookingId: { in: bookingIds } } }),
    prisma.scheduledMessage.deleteMany({ where: { bookingId: { in: bookingIds } } }),
    prisma.unmatchedMessage.deleteMany({ where: { ownerId: owner.id } }),
    prisma.booking.updateMany({
      where: { id: { in: bookingIds } },
      data: {
        guestName: null,
        guestPhone: null,
        guestLanguage: null,
        notes: null,
        optedInAt: null,
        anonymisedAt: new Date(),
      },
    }),
    prisma.auditLog.create({
      data: {
        ownerId: owner.id,
        action: "ACCOUNT_LEVEL_ERASE",
        targetType: "owner",
        targetId: owner.id,
      },
    }),
  ]);

  console.log("Deleted guest data for owner:", email);
  console.log("Messages deleted:", result[0].count);
  console.log("Scheduled messages deleted:", result[1].count);
  console.log("Unmatched messages deleted:", result[2].count);
  console.log("Bookings anonymised:", result[3].count);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
