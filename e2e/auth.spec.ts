import { test, expect } from "@playwright/test";
import { loginMain, waitForHydration } from "./helpers";
import { E2E_LOCK_OWNER_EMAIL, E2E_OWNER_PASSWORD } from "./constants";

const PROTECTED = [
  "/calendar",
  "/inbox",
  "/apartments",
  "/bookings/new",
  "/leads",
  "/assistant/test",
  "/reviews/draft",
  "/settings",
];

test.describe("auth and route protection", () => {
  test("protected pages redirect to /login when logged out", async ({ page }) => {
    for (const path of PROTECTED) {
      await page.goto(path);
      await expect(page, `${path} should redirect to /login`).toHaveURL(/\/login/);
    }
  });

  test("public routes stay public", async ({ page, request }) => {
    await page.goto("/privacy");
    await expect(page).toHaveURL(/\/privacy/);
    await expect(page.getByRole("heading").first()).toBeVisible();

    const health = await request.get("/api/health");
    expect(health.ok()).toBeTruthy();
    expect((await health.json()).ok).toBe(true);
  });

  test("cron routes reject requests without the secret", async ({ request }) => {
    for (const path of [
      "/api/cron/send-scheduled",
      "/api/cron/tick",
      "/api/cron/retention",
      "/api/cron/self-check",
    ]) {
      const res = await request.post(path);
      expect(res.status(), path).toBe(401);
    }
  });

  test("webhook route rejects unsigned posts", async ({ request }) => {
    const res = await request.post("/api/webhooks/meta", { data: {} });
    expect([401, 403]).toContain(res.status());
  });
});

test.describe("login", () => {
  test("wrong password shows a generic error", async ({ page }) => {
    await page.goto("/login");
    await waitForHydration(page);
    await page.locator("#email").fill(E2E_LOCK_OWNER_EMAIL);
    await page.locator("#password").fill("definitely-wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    // First auth hit can be slow while the server warms up.
    await expect(page.getByText(/Email or password is wrong/)).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test("account locks out after 5 failures, even with the right password", async ({
    page,
  }) => {
    // One failure already recorded by the previous test; reach the threshold.
    for (let i = 0; i < 5; i++) {
      await page.goto("/login");
      await waitForHydration(page);
      await page.locator("#email").fill(E2E_LOCK_OWNER_EMAIL);
      await page.locator("#password").fill("wrong-password-again");
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page.getByText(/Email or password is wrong/)).toBeVisible();
    }
    await page.goto("/login");
    await waitForHydration(page);
    await page.locator("#email").fill(E2E_LOCK_OWNER_EMAIL);
    await page.locator("#password").fill(E2E_OWNER_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(/Email or password is wrong/)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("successful login lands on the calendar and sign out returns to /login", async ({
    page,
  }) => {
    await loginMain(page);
    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/calendar");
    await expect(page).toHaveURL(/\/login/);
  });
});
