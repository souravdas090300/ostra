import fs from "fs";
import path from "path";

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");

const sqliteSchema = `// This is your Prisma schema file,
// learn more about it in the docs: https://pris.ly/d/prisma-schema

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model Owner {
  id           String      @id @default(cuid())
  email        String      @unique
  passwordHash String
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt

  apartments   Apartment[]
}

model Apartment {
  id             String   @id @default(cuid())
  ownerId        String
  name           String
  address        String
  checkInTime    String   // Format: "14:00"
  checkOutTime   String   // Format: "11:00"
  info           String   @default("")
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  owner          Owner    @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  feeds          CalendarFeed[]
  bookings       Booking[]

  @@index([ownerId])
}

model CalendarFeed {
  id         String   @id @default(cuid())
  apartmentId String
  source     String   // AIRBNB, BOOKING_COM, DIRECT
  icalUrl    String
  lastSyncAt DateTime?
  lastError  String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  apartment  Apartment @relation(fields: [apartmentId], references: [id], onDelete: Cascade)

  @@index([apartmentId])
}

model Booking {
  id          String   @id @default(cuid())
  apartmentId String
  externalUid String?  // For synced bookings from iCal feeds
  source      String   // AIRBNB, BOOKING_COM, DIRECT
  status      String   @default("CONFIRMED") // CONFIRMED, CANCELLED
  checkIn     DateTime
  checkOut    DateTime
  guestName   String?
  guestPhone  String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  apartment   Apartment @relation(fields: [apartmentId], references: [id], onDelete: Cascade)

  @@unique([apartmentId, externalUid])
  @@index([apartmentId])
  @@index([externalUid])
}`;

const postgresSchema = `// This is your Prisma schema file,
// learn more about it in the docs: https://pris.ly/d/prisma-schema

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  directUrl = env("DATABASE_URL_UNPOOLED")
}

enum BookingSource {
  AIRBNB
  BOOKING_COM
  DIRECT
}

enum BookingStatus {
  CONFIRMED
  CANCELLED
}

model Owner {
  id           String      @id @default(cuid())
  email        String      @unique
  passwordHash String
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt

  apartments   Apartment[]
}

model Apartment {
  id             String   @id @default(cuid())
  ownerId        String
  name           String
  address        String
  checkInTime    String   // Format: "14:00"
  checkOutTime   String   // Format: "11:00"
  info           String   @default("")
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  owner          Owner    @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  feeds          CalendarFeed[]
  bookings       Booking[]

  @@index([ownerId])
}

model CalendarFeed {
  id         String        @id @default(cuid())
  apartmentId String
  source     BookingSource
  icalUrl    String
  lastSyncAt DateTime?
  lastError  String?
  createdAt  DateTime      @default(now())
  updatedAt  DateTime      @updatedAt

  apartment  Apartment     @relation(fields: [apartmentId], references: [id], onDelete: Cascade)

  @@index([apartmentId])
}

model Booking {
  id          String        @id @default(cuid())
  apartmentId String
  externalUid String?       // For synced bookings from iCal feeds
  source      BookingSource
  status      BookingStatus @default(CONFIRMED)
  checkIn     DateTime
  checkOut    DateTime
  guestName   String?
  guestPhone  String?
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  apartment   Apartment     @relation(fields: [apartmentId], references: [id], onDelete: Cascade)

  @@unique([apartmentId, externalUid])
  @@index([apartmentId])
  @@index([externalUid])
}`;

const command = process.argv[2];

if (command === "dev") {
  fs.writeFileSync(schemaPath, sqliteSchema);
  console.log("Switched to SQLite schema for local development");
} else if (command === "prod") {
  fs.writeFileSync(schemaPath, postgresSchema);
  console.log("Switched to PostgreSQL schema for production");
} else {
  console.log("Usage: node scripts/switch-env.js [dev|prod]");
  console.log("  dev   - Switch to SQLite schema (local development)");
  console.log("  prod  - Switch to PostgreSQL schema (production with Neon)");
  process.exit(1);
}
