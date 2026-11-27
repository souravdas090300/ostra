import { defineConfig } from "@playwright/test";

// Reuse the throwaway test environment (.env.test) for local runs. CI provides
// the variables itself, so the file is only loaded when DATABASE_URL is unset.
// NODE_ENV is removed so the webServer (next dev / next start) controls it;
// E2E=1 lets LLM_FAKE run under next start's production mode — see
// lib/llm-client.ts.
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(".env.test");
  } catch {
    // .env.test missing: rely on real environment variables.
  }
}
Reflect.deleteProperty(process.env, "NODE_ENV");

export const E2E_PORT = 3100;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  // One worker: specs share seeded fixtures in the test database.
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command:
      process.env.E2E_DEV === "1"
        ? `npm run dev -- -p ${E2E_PORT}`
        : `npm run start -- -p ${E2E_PORT}`,
    url: `${E2E_BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      ...process.env,
      NODE_ENV: "production",
      TZ: "UTC",
      APP_URL: E2E_BASE_URL,
      // .env.local pins NEXTAUTH_URL to :3000; override so auth redirects stay on the E2E port.
      AUTH_URL: E2E_BASE_URL,
      NEXTAUTH_URL: E2E_BASE_URL,
      LLM_FAKE: "1",
      WHATSAPP_MODE: "dry-run",
      E2E: "1",
      PORT: String(E2E_PORT),
    },
  },
});
