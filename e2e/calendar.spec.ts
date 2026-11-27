import { test, expect } from "@playwright/test";
import { loginMain, maltaTodayPlus, waitForHydration } from "./helpers";

test.describe("calendar", () => {
  test("shows seeded bookings, a flagged double booking and no horizontal scroll at 390px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginMain(page);
    const from = await maltaTodayPlus(0);
    await page.goto(`/calendar?from=${from}&days=14`);

    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
    await expect(page.getByText("Needs attention")).toBeVisible();
    await expect(page.getByText("Double bookings")).toBeVisible();
    await expect(page.getByLabel(/Maria E2E/)).toBeVisible();

    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(scrollWidth).toBeLessThanOrEqual(390);
  });

  test("create a direct booking, accept the overlap warning, see it on the calendar", async ({
    page,
  }) => {
    await loginMain(page);
    await page.goto("/bookings/new");
    await waitForHydration(page);

    const inYmd = await maltaTodayPlus(7);
    const outYmd = await maltaTodayPlus(9);
    await page.locator('input[name="checkIn"]').fill(inYmd);
    await page.locator('input[name="checkOut"]').fill(outYmd);
    await page.locator('input[name="guestName"]').fill("New E2E Guest");
    await page.locator('input[name="guestPhone"]').fill("+35699333333");
    // Select last: an early change can be reset by hydration of the uncontrolled select.
    const apartmentSelect = page.locator('select[name="apartmentId"]');
    await apartmentSelect.selectOption({ label: "E2E Sea View" });
    await expect(apartmentSelect).not.toHaveValue("");

    await page.getByRole("button", { name: "Create booking" }).click();
    await expect(page.getByText("These dates overlap:")).toBeVisible();
    await page.getByRole("button", { name: "Save anyway" }).click();
    // A saved booking redirects to its detail page.
    await expect(page).toHaveURL(/\/bookings\//);
    await expect(page.getByText("Booking saved.")).toBeVisible();

    await page.goto(`/calendar?from=${await maltaTodayPlus(0)}&days=14`);
    await expect(page.getByLabel(/New E2E Guest/)).toBeVisible();
  });

  test("edit an apartment's information and see it saved", async ({ page }) => {
    await loginMain(page);
    await page.goto("/apartments");
    await page.getByRole("link", { name: "E2E Sea View" }).first().click();
    await waitForHydration(page);

    const info = page.locator('textarea[name="info"]');
    await info.fill("Wi-Fi password: rotated-e2e-secret");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 30_000 });

    await page.reload();
    await expect(info).toHaveValue("Wi-Fi password: rotated-e2e-secret");
  });
});
