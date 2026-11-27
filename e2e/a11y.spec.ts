import { test, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { loginMain } from "./helpers";

const PAGES = ["/login", "/calendar", "/inbox", "/settings"];

test.describe("accessibility", () => {
  for (const path of PAGES) {
    test(`no serious or critical axe violations on ${path}`, async ({ page }) => {
      if (path !== "/login") await loginMain(page);
      await page.goto(path);
      await page.waitForLoadState("load");

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      const serious = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(
        serious.map((v) => `${v.id}: ${v.nodes.length} node(s)`),
        `serious/critical violations on ${path}`,
      ).toEqual([]);
    });
  }
});
