import { test, expect } from "@playwright/test";
import { loginMain, prisma, waitForHydration } from "./helpers";
import { hashPhone } from "../lib/hash";

test.describe("guest data erasure", () => {
  test("erasing a guest removes messages and name, keeps the booking and the opt-out", async ({
    page,
  }) => {
    await loginMain(page);

    const booking = await prisma.booking.findFirst({
      where: { guestName: "Erase Guest" },
      include: { apartment: { include: { owner: true } } },
    });
    expect(booking).toBeTruthy();
    const inYmd = booking!.checkIn.toISOString().slice(0, 10);
    const outYmd = booking!.checkOut.toISOString().slice(0, 10);

    await page.goto(`/bookings/${booking!.id}`);
    await expect(
      page.getByRole("heading", { name: "Erase Guest" }),
    ).toBeVisible();
    await waitForHydration(page);

    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "Erase guest data (this booking)" })
      .click();
    await page.waitForLoadState("load");

    // Guest identity and messages are gone; the stay itself remains.
    await expect(
      page.getByRole("heading", { name: "Erase Guest" }),
    ).toHaveCount(0);
    await expect(page.getByText("Erase me please")).toHaveCount(0);
    const after = await prisma.booking.findUnique({ where: { id: booking!.id } });
    expect(after?.guestName).toBeNull();
    expect(after?.guestPhone).toBeNull();
    expect(after?.anonymisedAt).not.toBeNull();
    expect(after?.checkIn.toISOString().slice(0, 10)).toBe(inYmd);
    expect(after?.checkOut.toISOString().slice(0, 10)).toBe(outYmd);
    expect(
      await prisma.message.count({ where: { bookingId: booking!.id } }),
    ).toBe(0);

    // The opt-out hash for the number survives erasure.
    const optOut = await prisma.optOut.findFirst({
      where: { ownerId: booking!.apartment.ownerId, phoneHash: hashPhone("+35677000001") },
    });
    expect(optOut).toBeTruthy();
  });
});
