import { defineConfig } from "vitest/config";
import path from "path";
import { loadEnv } from "vite";

export default defineConfig(() => {
  const testEnv = loadEnv("test", process.cwd(), "");
  const databaseUrl = process.env.DATABASE_URL ?? testEnv.DATABASE_URL ?? "";
  if (!/ostra_test/.test(databaseUrl)) {
    throw new Error("Refusing to run tests: DATABASE_URL must target the disposable ostra_test database.");
  }

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
