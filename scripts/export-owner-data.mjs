#!/usr/bin/env node

/**
 * Account-level export script.
 * Exports all guest data for an owner (all bookings, messages, unmatched messages).
 * Usage: node scripts/export-owner-data.mjs <owner-email>
 */

import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "fs";
import { join } from "path";

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: node scripts/export-owner-data.mjs <owner-email>");
    process.exit(1);
  }

  const owner = await prisma.owner.findUnique({
    where: { email },
    include: {
      apartments: {
        include: {
          bookings: {
            include: {
              messages: true,
              scheduled: true,
            },
          },
        },
      },
      unmatched: true,
    },
  });

  if (!owner) {
    console.error(`Owner with email ${email} not found`);
    process.exit(1);
  }

  const exportData = {
    owner: {
      email: owner.email,
      createdAt: owner.createdAt,
    },
    apartments: owner.apartments.map((apt) => ({
      name: apt.name,
      address: apt.address,
      bookings: apt.bookings.map((b) => ({
        id: b.id,
        source: b.source,
        status: b.status,
        checkIn: b.checkIn,
        checkOut: b.checkOut,
        guestName: b.guestName,
        guestPhone: b.guestPhone,
        guestLanguage: b.guestLanguage,
        notes: b.notes,
        optedInAt: b.optedInAt,
        optedOutAt: b.optedOutAt,
        anonymisedAt: b.anonymisedAt,
        messages: b.messages.map((m) => ({
          direction: m.direction,
          author: m.author,
          body: m.body,
          originalBody: m.originalBody,
          language: m.language,
          escalated: m.escalated,
          urgent: m.urgent,
          createdAt: m.createdAt,
        })),
        scheduledMessages: b.scheduled.map((s) => ({
          type: s.type,
          sendAt: s.sendAt,
          status: s.status,
          lastError: s.lastError,
        })),
      })),
    })),
    unmatchedMessages: owner.unmatched.map((m) => ({
      phone: m.phone,
      body: m.body,
      hasMedia: m.hasMedia,
      receivedAt: m.receivedAt,
    })),
    exportedAt: new Date().toISOString(),
  };

  const filename = join(process.cwd(), `owner-export-${email.replace(/[^a-z0-9]/gi, "-")}-${Date.now()}.json`);
  writeFileSync(filename, JSON.stringify(exportData, null, 2));
  console.log(`Export written to ${filename}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
