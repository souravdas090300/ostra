import { prisma } from "./db";

const DAY = 86_400_000;
export const MATCH_BEFORE_MS = 3 * DAY; // guests write before arriving
export const MATCH_AFTER_MS = 1 * DAY; // and a little after leaving
export const DETAILS_BEFORE_MS = 24 * 3_600_000;
export const DETAILS_AFTER_MS = 24 * 3_600_000;

type Cand = { id: string; checkIn: Date; checkOut: Date };

/** Pure choice among bookings that share a phone number. In-house first, else the next arrival, else the latest past stay. */
export function chooseBooking<T extends Cand>(cands: T[], now: Date): { booking: T; ambiguous: boolean } | null {
  const t = now.getTime();
  const within = cands.filter(
    (b) => t >= b.checkIn.getTime() - MATCH_BEFORE_MS && t <= b.checkOut.getTime() + MATCH_AFTER_MS,
  );
  if (within.length === 0) return null;
  const inHouse = within.filter((b) => b.checkIn.getTime() <= t && t <= b.checkOut.getTime());
  const upcoming = within.filter((b) => b.checkIn.getTime() > t).sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime());
  const past = [...within].sort((a, b) => b.checkOut.getTime() - a.checkOut.getTime());
  const ordered = inHouse.length ? inHouse.sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime()) : upcoming.length ? upcoming : past;
  return { booking: ordered[0], ambiguous: within.length > 1 };
}

/** Private details (codes, Wi-Fi, address) may be shown only inside this window. */
export function detailsUnlocked(b: Cand, now: Date): boolean {
  const t = now.getTime();
  return t >= b.checkIn.getTime() - DETAILS_BEFORE_MS && t <= b.checkOut.getTime() + DETAILS_AFTER_MS;
}

export async function matchBooking(ownerId: string, e164: string, now = new Date()) {
  const rows = await prisma.booking.findMany({
    where: {
      guestPhone: e164,
      status: "CONFIRMED",
      isBlock: false,
      apartment: { ownerId }, // another owner's booking with the same number never matches
      checkIn: { lte: new Date(now.getTime() + MATCH_BEFORE_MS) },
      checkOut: { gte: new Date(now.getTime() - MATCH_AFTER_MS) },
    },
    include: { apartment: true },
  });
  return chooseBooking(rows, now);
}
