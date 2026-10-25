import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_OWNER_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_OWNER_PASSWORD;
  if (!email || !password || password.length < 12)
    throw new Error("Set SEED_OWNER_EMAIL and a SEED_OWNER_PASSWORD of at least 12 characters.");
  const production = process.env.NODE_ENV === "production";
  if (production && !process.argv.includes("--allow-production"))
    throw new Error("Refusing to seed production without --allow-production.");

  const owner = await prisma.owner.upsert({
    where: { email },
    update: {}, // never overwrite an existing password
    create: { email, name: "Host", passwordHash: await bcrypt.hash(password, 12) },
  });
  if (production) return;

  // Development demo data: three apartments with starter text.
  const names = ["Sliema Seaview", "Valletta Courtyard", "Gozo Farmhouse"];
  for (const name of names) {
    const exists = await prisma.apartment.findFirst({
      where: { ownerId: owner.id, name },
    });
    if (!exists) {
      await prisma.apartment.create({
        data: { ownerId: owner.id, name, address: `${name}, Malta`, info: "" },
      });
    }
  }
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
