import { execSync } from "node:child_process";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { addDays } from "../lib/dates";
import { maltaLocalToUtc, maltaYmd } from "../lib/time";
import { hashPhone } from "../lib/hash";
import {
  E2E_OWNER_EMAIL,
  E2E_OWNER_PASSWORD,
  E2E_PASSWORD_OWNER_EMAIL,
  E2E_LOCK_OWNER_EMAIL,
} from "./constants";

const prisma = new PrismaClient();

async function upsertOwner(email: string) {
  const passwordHash = await bcrypt.hash(E2E_OWNER_PASSWORD, 12);
  return prisma.owner.upsert({
    where: { email },
    // Always reset the hash so repeated runs stay deterministic (the
    // password-change spec mutates it).
    update: { passwordHash },
    create: { email, passwordHash },
  });
}

async function seedMainOwner() {
  const owner = await upsertOwner(E2E_OWNER_EMAIL);

  // Rebuild the demo apartment and its bookings from scratch each run so
  // specs that create bookings cannot accumulate duplicates.
  const stale = await prisma.apartment.findMany({
    where: { ownerId: owner.id, name: "E2E Sea View" },
    select: { id: true },
  });
  await prisma.apartment.deleteMany({ where: { id: { in: stale.map((a) => a.id) } } });

  const apartment = await prisma.apartment.create({
    data: {
      ownerId: owner.id,
      name: "E2E Sea View",
      address: "1 Test Street, Sliema, Malta",
      checkInTime: "14:00",
      checkOutTime: "11:00",
      info: "Wi-Fi password: e2e-only",
      publicInfo: "Sea view apartment in Sliema.",
      maxGuests: 4,
    },
  });

  const today = maltaYmd(new Date());
  const inYmd = addDays(today, 5);
  const outYmd = addDays(today, 8);
  const overlapIn = addDays(today, 6);
  const overlapOut = addDays(today, 9);
  const eraseIn = addDays(today, 10);
  const eraseOut = addDays(today, 12);

  const booking = await prisma.booking.create({
    data: {
      apartmentId: apartment.id,
      source: "DIRECT",
      guestName: "Maria E2E",
      guestPhone: "+35699123456",
      guestLanguage: "en",
      guests: 2,
      checkIn: maltaLocalToUtc(inYmd, "14:00"),
      checkOut: maltaLocalToUtc(outYmd, "11:00"),
    },
  });
  // Overlapping stay on the same apartment -> double booking in attention panel.
  await prisma.booking.create({
    data: {
      apartmentId: apartment.id,
      source: "AIRBNB",
      guestName: "John E2E",
      guestPhone: "+35699222222",
      guestLanguage: "en",
      checkIn: maltaLocalToUtc(overlapIn, "15:00"),
      checkOut: maltaLocalToUtc(overlapOut, "10:00"),
    },
  });
  // Guest whose data will be erased in the privacy spec.
  const eraseBooking = await prisma.booking.create({
    data: {
      apartmentId: apartment.id,
      source: "DIRECT",
      guestName: "Erase Guest",
      guestPhone: "+35677000001",
      guestLanguage: "en",
      checkIn: maltaLocalToUtc(eraseIn, "14:00"),
      checkOut: maltaLocalToUtc(eraseOut, "11:00"),
    },
  });

  const hourAgo = new Date(Date.now() - 60 * 60_000);
  await prisma.message.create({
    data: {
      bookingId: booking.id,
      direction: "INBOUND",
      author: "GUEST",
      body: "Do you have parking available?",
      language: "en",
      escalated: true,
      resolved: false,
      hostSummary: "Guest asks about parking.",
      createdAt: hourAgo,
    },
  });
  await prisma.message.create({
    data: {
      bookingId: booking.id,
      direction: "OUTBOUND",
      author: "SYSTEM",
      body: "Thanks for your message.",
      createdAt: new Date(hourAgo.getTime() - 60_000),
    },
  });
  await prisma.message.create({
    data: {
      bookingId: eraseBooking.id,
      direction: "INBOUND",
      author: "GUEST",
      body: "Erase me please",
      language: "en",
      createdAt: hourAgo,
    },
  });
  await prisma.message.create({
    data: {
      bookingId: eraseBooking.id,
      direction: "OUTBOUND",
      author: "HOST",
      body: "Sure, anything else?",
      createdAt: new Date(hourAgo.getTime() - 30_000),
    },
  });

  // The opt-out list must survive erasure: keep a hash row for this number.
  await prisma.optOut.upsert({
    where: { ownerId_phoneHash: { ownerId: owner.id, phoneHash: hashPhone("+35677000001") } },
    create: { ownerId: owner.id, phoneHash: hashPhone("+35677000001") },
    update: {},
  });
}

export default async function globalSetup() {
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
  await prisma.loginAttempt.deleteMany({});
  await upsertOwner(E2E_PASSWORD_OWNER_EMAIL);
  await upsertOwner(E2E_LOCK_OWNER_EMAIL);
  await seedMainOwner();
  await prisma.$disconnect();
}
