import { execSync } from "node:child_process";
import { loadEnv } from "vite";
import { assertSafeTestDatabaseUrl } from "../lib/test-database-guard";

/**
 * Vitest globalSetup: runs once before any test file.
 *
 * Applies pending Prisma migrations to the disposable test database so an
 * empty database never causes missing-table failures. The database URL is
 * resolved the same way vitest.config.ts resolves it (process.env first,
 * then .env.test), and the *_test / forbidden-host guard runs before any
 * migration is applied — this setup can never touch a non-test database.
 */
export default function setup(): void {
  const databaseUrl =
    process.env.DATABASE_URL ??
    loadEnv("test", process.cwd(), "").DATABASE_URL ??
    "";

  assertSafeTestDatabaseUrl(databaseUrl);

  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });
}
