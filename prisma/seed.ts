import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { maltaLocalToUtc } from "../lib/time";
import { addDays, todayMalta } from "../lib/dates";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_EMAIL || "admin@ostra.test";
  const password = process.env.SEED_PASSWORD || "password123";

  const passwordHash = await bcrypt.hash(password, 10);

  // Create owner
  const owner = await prisma.owner.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
    },
  });

  console.log(`Created owner: ${owner.email}`);

  // Delete existing bookings and feeds for idempotency
  await prisma.booking.deleteMany({
    where: {
      apartment: { ownerId: owner.id },
    },
  });
  await prisma.calendarFeed.deleteMany({
    where: {
      apartment: { ownerId: owner.id },
    },
  });

  // Create 3 apartments
  const apartment1 = await prisma.apartment.upsert({
    where: { id: "apt-1" },
    update: {},
    create: {
      id: "apt-1",
      ownerId: owner.id,
      name: "Valletta Harbor View",
      address: "123 St. Christopher Street, Valletta, Malta",
      checkInTime: "15:00",
      checkOutTime: "11:00",
      info: `Check-in steps: Meet at the building entrance, I'll hand over the keys.\n\nKey/lockbox: Key will be handed over in person.\n\nWi-Fi: Network: VallettaGuest, Password: Malta2024\n\nParking: Street parking available nearby (free after 5pm).\n\nHouse rules: No smoking, no parties, quiet hours 10pm-8am.\n\nLocal tips: Try Caffe Cordina in St. George's Square for coffee. Visit Upper Barrakka Gardens for great views.\n\nEmergency contact: Maria at +356 1234 5678`,
    },
  });

  const apartment2 = await prisma.apartment.upsert({
    where: { id: "apt-2" },
    update: {},
    create: {
      id: "apt-2",
      ownerId: owner.id,
      name: "Sliema Beach Apartment",
      address: "45 Tower Road, Sliema, Malta",
      checkInTime: "14:00",
      checkOutTime: "10:00",
      info: `Check-in steps: Keys are in the lockbox with code 1234.\n\nKey/lockbox: Gray lockbox at the entrance. Code: 1234\n\nWi-Fi: Network: SliemaStay, Password: Beach2024\n\nParking: Paid parking garage across the street.\n\nHouse rules: No smoking on balcony, no pets allowed.\n\nLocal tips: Walk along the Sliema promenade. Take the ferry to Valletta.\n\nEmergency contact: John at +356 9876 5432`,
    },
  });

  const apartment3 = await prisma.apartment.upsert({
    where: { id: "apt-3" },
    update: {},
    create: {
      id: "apt-3",
      ownerId: owner.id,
      name: "Mdina Old Town Studio",
      address: "78 St. Paul's Square, Mdina, Malta",
      checkInTime: "15:00", // Changed for tight turnover scenario
      checkOutTime: "14:00", // Changed for tight turnover scenario
      info: `Check-in steps: Meet at the Mdina Gate, I'll escort you to the apartment.\n\nKey/lockbox: Keys handed over in person.\n\nWi-Fi: Network: MdinaHistoric, Password: SilentCity2024\n\nParking: Public parking outside Mdina walls (10 min walk).\n\nHouse rules: No smoking, respect the quiet atmosphere of Mdina.\n\nLocal tips: Visit the Mdina Cathedral. Try Fontanella Tea Garden for views.\n\nEmergency contact: Sarah at +356 5555 1234`,
    },
  });

  console.log(`Created 3 apartments`);

  // Phase 4 test scenarios
  const today = todayMalta();
  const now = new Date();

  // Double booking in apartment A: Airbnb stay today+3 .. today+6 and Booking.com stay today+5 .. today+8
  await prisma.booking.create({
    data: {
      apartmentId: apartment1.id,
      externalUid: "airbnb-double-1",
      source: "AIRBNB",
      status: "CONFIRMED",
      checkIn: maltaLocalToUtc(addDays(today, 3), "15:00"),
      checkOut: maltaLocalToUtc(addDays(today, 6), "11:00"),
      guestName: "Alice Airbnb",
    },
  });

  await prisma.booking.create({
    data: {
      apartmentId: apartment1.id,
      externalUid: "booking-com-double-1",
      source: "BOOKING_COM",
      status: "CONFIRMED",
      checkIn: maltaLocalToUtc(addDays(today, 5), "14:00"),
      checkOut: maltaLocalToUtc(addDays(today, 8), "10:00"),
      guestName: "Bob Booking.com",
    },
  });

  // Same-day turnover (4 h gap) in apartment B: Airbnb today+1 .. today+4, direct today+4 .. today+7
  await prisma.booking.create({
    data: {
      apartmentId: apartment2.id,
      externalUid: "airbnb-turnover-1",
      source: "AIRBNB",
      status: "CONFIRMED",
      checkIn: maltaLocalToUtc(addDays(today, 1), "14:00"),
      checkOut: maltaLocalToUtc(addDays(today, 4), "10:00"),
      guestName: "Charlie Airbnb",
    },
  });

  await prisma.booking.create({
    data: {
      apartmentId: apartment2.id,
      source: "DIRECT",
      status: "CONFIRMED",
      checkIn: maltaLocalToUtc(addDays(today, 4), "14:00"),
      checkOut: maltaLocalToUtc(addDays(today, 7), "10:00"),
      guestName: "Diana Direct",
      guestPhone: "+356 1111 2222",
    },
  });

  // Tight turnover (1 h gap) in apartment C: stays today-2 .. today+2 and today+2 .. today+5
  await prisma.booking.create({
    data: {
      apartmentId: apartment3.id,
      externalUid: "airbnb-tight-1",
      source: "AIRBNB",
      status: "CONFIRMED",
      checkIn: maltaLocalToUtc(addDays(today, -2), "15:00"),
      checkOut: maltaLocalToUtc(addDays(today, 2), "14:00"),
      guestName: "Eve Airbnb",
    },
  });

  await prisma.booking.create({
    data: {
      apartmentId: apartment3.id,
      source: "DIRECT",
      status: "CONFIRMED",
      checkIn: maltaLocalToUtc(addDays(today, 2), "15:00"),
      checkOut: maltaLocalToUtc(addDays(today, 5), "14:00"),
      guestName: "Frank Direct",
      guestPhone: "+356 3333 4444",
    },
  });

  // Block in apartment B: today+10 .. today+13
  await prisma.booking.create({
    data: {
      apartmentId: apartment2.id,
      externalUid: "block-1",
      source: "AIRBNB",
      status: "CONFIRMED",
      checkIn: maltaLocalToUtc(addDays(today, 10), "14:00"),
      checkOut: maltaLocalToUtc(addDays(today, 13), "10:00"),
      isBlock: true,
    },
  });

  // Mirrored block overlapping a booking in apartment C: block today+2 .. today+5 over the second stay
  await prisma.booking.create({
    data: {
      apartmentId: apartment3.id,
      externalUid: "block-mirrored-1",
      source: "BOOKING_COM",
      status: "CONFIRMED",
      checkIn: maltaLocalToUtc(addDays(today, 2), "15:00"),
      checkOut: maltaLocalToUtc(addDays(today, 5), "14:00"),
      isBlock: true,
    },
  });

  // Missing phone: one arrival in 3 days without guestPhone
  await prisma.booking.create({
    data: {
      apartmentId: apartment1.id,
      externalUid: "airbnb-missing-phone-1",
      source: "AIRBNB",
      status: "CONFIRMED",
      checkIn: maltaLocalToUtc(addDays(today, 3), "15:00"),
      checkOut: maltaLocalToUtc(addDays(today, 6), "11:00"),
      guestName: "Grace No Phone",
    },
  });

  // Stale feed: one feed with lastSuccessAt 5 hours ago
  const fiveHoursAgo = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  await prisma.calendarFeed.create({
    data: {
      apartmentId: apartment1.id,
      source: "AIRBNB",
      icalUrl: "https://airbnb.com/stale.ics",
      lastSyncAt: fiveHoursAgo,
      lastSuccessAt: fiveHoursAgo,
    },
  });

  // Feed with lastError set
  await prisma.calendarFeed.create({
    data: {
      apartmentId: apartment2.id,
      source: "BOOKING_COM",
      icalUrl: "https://booking.com/error.ics",
      lastSyncAt: new Date(),
      lastError: "Network timeout",
    },
  });

  // Feed never synced
  await prisma.calendarFeed.create({
    data: {
      apartmentId: apartment3.id,
      source: "AIRBNB",
      icalUrl: "https://airbnb.com/never.ics",
    },
  });

  console.log(`Created Phase 4 test scenarios`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
