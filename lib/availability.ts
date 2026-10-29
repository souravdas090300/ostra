import { prisma } from "./db";
import { addDays, todayMalta } from "./dates";
import { maltaYmd } from "./time";
import { loadStays } from "./calendar-data";
import { syncFeed } from "./sync";
import {
  evaluateApartment,
  shiftedWindows,
  type AptInput,
  type AvailabilityResult,
  CALENDAR_STALE_MS,
} from "./availability-core";

type Params = {
  checkIn: Date;
  checkOut: Date;
  guests: number;
  apartmentId?: string;
  now?: Date;
};

async function loadApartments(
  ownerId: string,
  apartmentId?: string,
): Promise<AptInput[]> {
  const rows = await prisma.apartment.findMany({
    where: { ownerId, ...(apartmentId ? { id: apartmentId } : {}) },
    orderBy: { name: "asc" },
    include: {
      rates: true,
      feeds: {
        select: { lastSuccessAt: true, lastError: true },
      },
    },
  });
  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    maxGuests: a.maxGuests,
    bedrooms: a.bedrooms,
    minNights: a.minNights,
    baseNightlyCents: a.baseNightlyCents,
    cleaningFeeCents: a.cleaningFeeCents,
    rates: a.rates?.map((r) => ({
      startYmd: r.startDate.toISOString().slice(0, 10),
      endYmd: r.endDate.toISOString().slice(0, 10),
      nightlyCents: r.nightlyCents,
      minNights: r.minNights,
      createdAt: r.createdAt,
    })) || [],
    feeds: a.feeds?.map((c) => ({
      lastSuccessAt: c.lastSuccessAt,
      lastError: c.lastError,
    })) || [],
  }));
}

/** Sync feeds older than CALENDAR_FRESH_MINUTES, in parallel, bounded to 8 seconds in total. */
export async function ensureFreshCalendars(
  ownerId: string,
  apartmentId?: string,
  now = new Date(),
) {
  const maxAge = Number(process.env.CALENDAR_FRESH_MINUTES ?? 15) * 60_000;
  const feeds = await prisma.calendarFeed.findMany({
    where: {
      apartment: {
        ownerId,
        ...(apartmentId ? { id: apartmentId } : {}),
      },
    },
    select: { id: true, lastSyncAt: true },
  });
  const old = feeds.filter(
    (f) => !f.lastSyncAt || now.getTime() - f.lastSyncAt.getTime() > maxAge,
  );
  await Promise.race([
    Promise.all(old.map((f) => syncFeed(f.id))),
    new Promise((r) => setTimeout(r, 8_000)),
  ]);
}

/** Check if any feed is stale (older than 60 minutes or has errors). */
export async function calendarsStale(
  ownerId: string,
  apartmentId?: string,
  now = new Date(),
): Promise<boolean> {
  const feeds = await prisma.calendarFeed.findMany({
    where: {
      apartment: {
        ownerId,
        ...(apartmentId ? { id: apartmentId } : {}),
      },
    },
    select: { lastSuccessAt: true, lastError: true },
  });
  const staleThreshold = 60 * 60_000; // 60 minutes
  return feeds.some(
    (f) =>
      !!f.lastError ||
      !f.lastSuccessAt ||
      now.getTime() - f.lastSuccessAt.getTime() > staleThreshold,
  );
}

export async function getAvailability(
  ownerId: string,
  p: Params,
): Promise<AvailabilityResult[]> {
  const now = p.now ?? new Date();
  const inYmd = maltaYmd(p.checkIn),
    outYmd = maltaYmd(p.checkOut);
  const [apartments, stays] = await Promise.all([
    loadApartments(ownerId, p.apartmentId),
    loadStays(ownerId, inYmd, outYmd),
  ]);
  const byApt = (id: string) => stays.filter((s) => s.apartmentId === id);
  return apartments
    .map((a) =>
      evaluateApartment(a, byApt(a.id), {
        inYmd,
        outYmd,
        guests: p.guests,
        today: todayMalta(now),
        now,
      }),
    )
    .sort(
      (x, y) =>
        Number(y.available) - Number(x.available) ||
        (x.totalCents ?? 0) - (y.totalCents ?? 0) ||
        x.name.localeCompare(y.name),
    );
}

export async function findAlternatives(ownerId: string, p: Params) {
  const now = p.now ?? new Date();
  const inYmd = maltaYmd(p.checkIn),
    outYmd = maltaYmd(p.checkOut);
  const [apartments, stays] = await Promise.all([
    loadApartments(ownerId),
    loadStays(ownerId, addDays(inYmd, -7), addDays(outYmd, 7)),
  ]);
  const ctx = { inYmd, outYmd, guests: p.guests, today: todayMalta(now), now };
  const other = apartments
    .filter((a) => a.id !== p.apartmentId)
    .map((a) =>
      evaluateApartment(a, stays.filter((s) => s.apartmentId === a.id), ctx),
    )
    .filter((r) => r.available);
  const target = apartments.filter(
    (a) => !p.apartmentId || a.id === p.apartmentId,
  );
  const shifted = target
    .flatMap((a) =>
      shiftedWindows(a, stays.filter((s) => s.apartmentId === a.id), ctx).map(
        (w) => ({ apartmentId: a.id, name: a.name, ...w }),
      ),
    )
    .slice(0, 3);
  return { otherApartments: other, shiftedDates: shifted };
}

/** Like getAvailability, but syncs stale calendars and returns a calendarsStale flag. */
export async function getAvailabilityFresh(
  ownerId: string,
  p: Params,
): Promise<{ results: AvailabilityResult[]; calendarsStale: boolean }> {
  const now = p.now ?? new Date();
  await ensureFreshCalendars(ownerId, p.apartmentId, now);
  const results = await getAvailability(ownerId, p);
  const stale = await calendarsStale(ownerId, p.apartmentId, now);
  return { results, calendarsStale: stale };
}
