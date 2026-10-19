import { prisma } from "./db";
import { maltaLocalToUtc, maltaYmd } from "./time";
import { addDays } from "./dates";
import type { Stay } from "./conflicts";

const select = {
  id: true,
  apartmentId: true,
  source: true,
  isBlock: true,
  checkIn: true,
  checkOut: true,
  guestName: true,
  guestPhone: true,
} as const;

const toStay = (b: {
  id: string;
  apartmentId: string;
  source: string;
  isBlock: boolean;
  checkIn: Date;
  checkOut: Date;
  guestName: string | null;
  guestPhone: string | null;
}): Stay => ({
  ...b,
  source: b.source as Stay["source"],
  inYmd: maltaYmd(b.checkIn),
  outYmd: maltaYmd(b.checkOut),
});

/** Confirmed bookings and blocks of this owner that touch [fromYmd, toYmd). toYmd is exclusive. */
export async function loadStays(
  ownerId: string,
  fromYmd: string,
  toYmd: string
): Promise<Stay[]> {
  const rows = await prisma.booking.findMany({
    where: {
      apartment: { ownerId },
      status: "CONFIRMED",
      checkIn: { lt: maltaLocalToUtc(toYmd, "00:00") },
      checkOut: { gt: maltaLocalToUtc(fromYmd, "00:00") },
    },
    select,
    orderBy: [{ checkIn: "asc" }, { id: "asc" }],
  });
  return rows.map(toStay);
}

export async function loadCalendarData(
  ownerId: string,
  from: string,
  days: number,
  today: string
) {
  const to = addDays(from, days);
  const [apartments, viewStays, upcomingStays, feeds] = await Promise.all([
    prisma.apartment.findMany({
      where: { ownerId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    loadStays(ownerId, from, to),
    loadStays(ownerId, addDays(today, -1), addDays(today, 90)), // attention window, independent of the view
    prisma.calendarFeed.findMany({
      where: { apartment: { ownerId } },
      select: {
        id: true,
        apartmentId: true,
        source: true,
        lastSyncAt: true,
        lastSuccessAt: true,
        lastError: true,
        apartment: { select: { name: true } },
      },
    }),
  ]);
  return {
    apartments,
    viewStays,
    upcomingStays,
    feeds: feeds.map((f) => ({
      id: f.id,
      apartmentId: f.apartmentId,
      apartmentName: f.apartment.name,
      source: f.source as string,
      lastSyncAt: f.lastSyncAt,
      lastSuccessAt: f.lastSuccessAt,
      lastError: f.lastError,
    })),
  };
}
