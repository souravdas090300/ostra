import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

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
      checkInTime: "16:00",
      checkOutTime: "11:00",
      info: `Check-in steps: Meet at the Mdina Gate, I'll escort you to the apartment.\n\nKey/lockbox: Keys handed over in person.\n\nWi-Fi: Network: MdinaHistoric, Password: SilentCity2024\n\nParking: Public parking outside Mdina walls (10 min walk).\n\nHouse rules: No smoking, respect the quiet atmosphere of Mdina.\n\nLocal tips: Visit the Mdina Cathedral. Try Fontanella Tea Garden for views.\n\nEmergency contact: Sarah at +356 5555 1234`,
    },
  });

  console.log(`Created 3 apartments`);

  // Create sample bookings
  const today = new Date();
  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const twoWeeks = new Date(today);
  twoWeeks.setDate(twoWeeks.getDate() + 14);

  await prisma.booking.create({
    data: {
      apartmentId: apartment1.id,
      externalUid: "airbnb-booking-1",
      source: "AIRBNB",
      status: "CONFIRMED",
      checkIn: nextWeek,
      checkOut: twoWeeks,
      guestName: "John Smith",
    },
  });

  const threeWeeks = new Date(today);
  threeWeeks.setDate(threeWeeks.getDate() + 21);

  await prisma.booking.create({
    data: {
      apartmentId: apartment2.id,
      externalUid: "booking-com-booking-1",
      source: "BOOKING_COM",
      status: "CONFIRMED",
      checkIn: twoWeeks,
      checkOut: threeWeeks,
      guestName: "Emma Johnson",
    },
  });

  await prisma.booking.create({
    data: {
      apartmentId: apartment3.id,
      source: "DIRECT",
      status: "CONFIRMED",
      checkIn: new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000),
      checkOut: new Date(today.getTime() + 5 * 24 * 60 * 60 * 1000),
      guestName: "Michael Brown",
      guestPhone: "+356 7777 8888",
    },
  });

  console.log(`Created sample bookings`);
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
