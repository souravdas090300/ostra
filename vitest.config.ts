import { defineConfig } from "vitest/config";
import path from "path";
import { loadEnv } from "vite";
import { assertSafeTestDatabaseUrl } from "./lib/test-database-guard";

export default defineConfig(() => {
  const testEnv = loadEnv("test", process.cwd(), "");
  const databaseUrl = process.env.DATABASE_URL ?? testEnv.DATABASE_URL ?? "";

  // Refuse to run the suite against anything but a disposable *_test database
  // on a non-production host — tests seed and delete tenant data.
  assertSafeTestDatabaseUrl(databaseUrl);

  return {
    test: {
      globals: true,
      environment: "node",
      fileParallelism: false,
      env: testEnv,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
  };
});
