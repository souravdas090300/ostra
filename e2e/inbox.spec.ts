import { test, expect } from "@playwright/test";
import { loginMain, waitForHydration } from "./helpers";

test.describe("inbox", () => {
  test("seeded escalation is visible; reply resolves it and shows as You", async ({ page }) => {
    await loginMain(page);
    await page.goto("/inbox?tab=needs");

    await expect(page.getByText("Maria E2E")).toBeVisible();
    await expect(page.getByText("1 need you")).toBeVisible();
    await page.getByRole("link", { name: /Maria E2E/ }).click();
    await expect(page).toHaveURL(/\/inbox\//);
    await waitForHydration(page);

    // Same language (en) -> plain send, no translation step.
    const composer = page.locator("textarea").last();
    await composer.fill("Yes, there is free parking behind the building.");
    await page.getByRole("checkbox", { name: "Mark as resolved" }).check();
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Message sent successfully!")).toBeVisible();

    // The sent message appears as "You".
    await expect(page.getByText("Yes, there is free parking behind the building.")).toBeVisible();
    await expect(page.getByText("You").first()).toBeVisible();

    // Back on the inbox the item no longer needs a reply.
    await page.goto("/inbox?tab=needs");
    await expect(page.getByText("Nothing needs you right now.")).toBeVisible();
  });
});
