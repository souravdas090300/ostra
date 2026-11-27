import { expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { addDays } from "../lib/dates";
import { maltaYmd } from "../lib/time";
import { E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD } from "./constants";

export const prisma = new PrismaClient();

export async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await waitForHydration(page);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/calendar/);
}

export async function loginMain(page: Page) {
  await login(page, E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD);
}

export function maltaTodayPlus(days: number): string {
  return addDays(maltaYmd(new Date()), days);
}

/**
 * Wait until React has hydrated the page. Interacting earlier races hydration:
 * uncontrolled fields get reset to their defaultValue and server-action forms
 * may submit before listeners attach.
 */
export async function waitForHydration(page: Page) {
  // React attaches __reactFiber$/__reactProps$ expandos to the root container
  // once hydration completes; they are absent from server-rendered HTML.
  await page.waitForFunction(() =>
    Object.keys(document.body).some((k) => k.startsWith("__react")),
  );
}
