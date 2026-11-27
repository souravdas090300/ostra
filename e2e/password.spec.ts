import { test, expect } from "@playwright/test";
import { login, waitForHydration } from "./helpers";
import { E2E_PASSWORD_OWNER_EMAIL, E2E_OWNER_PASSWORD } from "./constants";

const NEW_PASSWORD = "NewE2ePassword456!";

test.describe("password change", () => {
  test("old password fails afterwards and an old session is rejected", async ({
    browser,
  }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();

    await login(page1, E2E_PASSWORD_OWNER_EMAIL, E2E_OWNER_PASSWORD);
    // A second, independent session that stays logged in across the change.
    await login(page2, E2E_PASSWORD_OWNER_EMAIL, E2E_OWNER_PASSWORD);

    await page1.goto("/settings/password");
    await waitForHydration(page1);
    await page1.locator("#currentPassword").fill(E2E_OWNER_PASSWORD);
    await page1.locator("#newPassword").fill(NEW_PASSWORD);
    await page1.locator("#confirmPassword").fill(NEW_PASSWORD);
    await page1.getByRole("button", { name: "Change password" }).click();
    await expect(page1).toHaveURL(/\/login/);

    // The session that was not used for the change is now rejected.
    await page2.goto("/calendar");
    await expect(page2).toHaveURL(/\/login/);

    // The old password no longer works.
    await page1.goto("/login");
    await waitForHydration(page1);
    await page1.locator("#email").fill(E2E_PASSWORD_OWNER_EMAIL);
    await page1.locator("#password").fill(E2E_OWNER_PASSWORD);
    await page1.getByRole("button", { name: "Sign in" }).click();
    await expect(page1.getByText(/Email or password is wrong/)).toBeVisible();

    // The new password does.
    await login(page1, E2E_PASSWORD_OWNER_EMAIL, NEW_PASSWORD);
    await expect(page1.getByRole("heading", { name: "Calendar" })).toBeVisible();

    await ctx1.close();
    await ctx2.close();
  });
});
