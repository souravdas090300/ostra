// Pre-flight check for the gated production migrate workflow.
// Fails closed unless:
//   1. public._prisma_migrations exists (the database is Prisma-managed), and
//   2. `prisma migrate status` reports the schema is up to date or that only
//      pending migrations remain.
// Note: `prisma migrate status` exits 0 in every non-error case and does NOT
// detect a missing _prisma_migrations table, so the history check must query
// the database directly.
import { PrismaClient } from "@prisma/client";
import { spawnSync } from "node:child_process";

const prisma = new PrismaClient();
let historyTable;
try {
  const rows = await prisma.$queryRaw`SELECT to_regclass('public._prisma_migrations')::text AS t`;
  historyTable = rows[0]?.t ?? null;
} catch (err) {
  console.error(`::error::Could not inspect the database: ${err.message}`);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}

if (!historyTable) {
  console.error(
    "::error::No _prisma_migrations table found — this database is not managed by Prisma migrate. Refusing to run migrations. Baseline the database first (see docs/RUNBOOK.md)."
  );
  process.exit(1);
}

const result = spawnSync("npx", ["prisma", "migrate", "status"], {
  encoding: "utf8",
  shell: true,
});
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
process.stdout.write(output);

const upToDate = /schema is up to date/i.test(output);
const onlyPending = /have not yet been applied/i.test(output);

if (!upToDate && !onlyPending) {
  console.error(
    "::error::Could not confirm a safe migration state (expected 'up to date' or 'pending migrations'). Refusing to proceed."
  );
  process.exit(1);
}

console.log(
  upToDate
    ? "Migration status OK: database schema is up to date."
    : "Migration status OK: only pending migrations remain; deploy will apply them."
);
