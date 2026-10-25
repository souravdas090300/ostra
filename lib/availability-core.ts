import { addDays, diffDays } from "./dates";

export const MAX_ENQUIRY_NIGHTS = 60;
export const MAX_FUTURE_DAYS = 730;
export const CALENDAR_STALE_MS = 3 * 3_600_000;

export type Unavailable =
  | "PAST_DATE"
  | "TOO_FAR"
  | "TOO_LONG"
  | "TOO_MANY_GUESTS"
  | "MIN_NIGHTS"
  | "BOOKED"
  | "NO_PRICE"
  | "CALENDAR_UNVERIFIED";

export type RateRow = {
  startYmd: string;
  endYmd: string;
  nightlyCents: number;
  minNights: number | null;
  createdAt: Date;
};
export type StayRow = { inYmd: string; outYmd: string }; // confirmed bookings and blocks of this apartment
export type FeedHealth = { lastSuccessAt: Date | null; lastError: string | null };

export type AptInput = {
  id: string;
  name: string;
  maxGuests: number;
  bedrooms: number;
  minNights: number;
  baseNightlyCents: number;
  cleaningFeeCents: number;
  rates: RateRow[];
  feeds: FeedHealth[];
};

export type AvailabilityResult = {
  apartmentId: string;
  name: string;
  available: boolean;
  reason?: Unavailable;
  nights: number;
  minNights: number;
  maxGuests: number;
  bedrooms: number;
  totalCents?: number;
  cleaningFeeCents?: number;
  nightly?: { date: string; cents: number }[];
  verified: boolean;
};

/** The narrowest rate covering the night wins; a tie goes to the newest rate; otherwise the base price. */
export function nightlyPrice(ymd: string, rates: RateRow[], baseCents: number): number {
  const covering = rates.filter((r) => r.startYmd <= ymd && ymd <= r.endYmd);
  if (covering.length === 0) return baseCents;
  covering.sort(
    (a, b) =>
      diffDays(a.startYmd, a.endYmd) - diffDays(b.startYmd, b.endYmd) ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );
  return covering[0].nightlyCents;
}

export function calendarVerified(feeds: FeedHealth[], now: Date): boolean {
  return feeds.every(
    (f) => !f.lastError && f.lastSuccessAt && now.getTime() - f.lastSuccessAt.getTime() <= CALENDAR_STALE_MS,
  );
}

/** minimum stay of the rate covering the check-in night, never lower than the apartment's own minimum */
export function requiredMinNights(inYmd: string, apt: AptInput): number {
  const covering = apt.rates.filter(
    (r) => r.startYmd <= inYmd && inYmd <= r.endYmd && r.minNights != null,
  );
  return Math.max(apt.minNights, ...covering.map((r) => r.minNights!));
}

export function evaluateApartment(
  apt: AptInput,
  stays: StayRow[],
  p: { inYmd: string; outYmd: string; guests: number; today: string; now: Date },
): AvailabilityResult {
  const nights = diffDays(p.inYmd, p.outYmd);
  const minNights = requiredMinNights(p.inYmd, apt);
  const base = {
    apartmentId: apt.id,
    name: apt.name,
    nights,
    minNights,
    maxGuests: apt.maxGuests,
    bedrooms: apt.bedrooms,
    verified: calendarVerified(apt.feeds, p.now),
  };
  const no = (reason: Unavailable): AvailabilityResult => ({ ...base, available: false, reason });

  if (p.inYmd < p.today) return no("PAST_DATE");
  if (diffDays(p.today, p.inYmd) > MAX_FUTURE_DAYS) return no("TOO_FAR");
  if (nights > MAX_ENQUIRY_NIGHTS) return no("TOO_LONG");
  if (p.guests > apt.maxGuests) return no("TOO_MANY_GUESTS");
  if (nights < minNights) return no("MIN_NIGHTS");
  if (stays.some((s) => s.inYmd < p.outYmd && s.outYmd > p.inYmd)) return no("BOOKED"); // overlap, back-to-back is fine
  if (!base.verified) return no("CALENDAR_UNVERIFIED"); // cannot be sure: do not quote

  const nightly = Array.from({ length: nights }, (_, i) => {
    const date = addDays(p.inYmd, i);
    return { date, cents: nightlyPrice(date, apt.rates, apt.baseNightlyCents) };
  });
  if (nightly.some((n) => n.cents <= 0)) return no("NO_PRICE");
  const total = nightly.reduce((n, x) => n + x.cents, 0) + apt.cleaningFeeCents;
  return {
    ...base,
    available: true,
    nightly,
    cleaningFeeCents: apt.cleaningFeeCents,
    totalCents: total,
  };
}

/** Same stay length shifted by up to maxShift days either way. Nearest first, at most `limit`. */
export function shiftedWindows(
  apt: AptInput,
  stays: StayRow[],
  p: { inYmd: string; outYmd: string; guests: number; today: string; now: Date },
  maxShift = 7,
  limit = 3,
) {
  const nights = diffDays(p.inYmd, p.outYmd);
  const found: { inYmd: string; outYmd: string; totalCents: number }[] = [];
  for (let d = 1; d <= maxShift && found.length < limit; d++) {
    for (const s of [-d, d]) {
      const inYmd = addDays(p.inYmd, s),
        outYmd = addDays(inYmd, nights);
      const r = evaluateApartment(apt, stays, { ...p, inYmd, outYmd });
      if (r.available && r.totalCents != null && found.length < limit)
        found.push({ inYmd, outYmd, totalCents: r.totalCents });
    }
  }
  return found;
}

/** Convert technical reason codes to plain language for the host. */
export function reasonToText(reason: Unavailable): string {
  const map: Record<Unavailable, string> = {
    PAST_DATE: "Date in the past",
    TOO_FAR: "Date too far ahead (more than 2 years)",
    TOO_LONG: "Stay too long (maximum 60 nights)",
    TOO_MANY_GUESTS: "Too many guests for this apartment",
    MIN_NIGHTS: "Minimum stay requirement not met",
    BOOKED: "Already booked",
    NO_PRICE: "Price not set for these dates",
    CALENDAR_UNVERIFIED: "Calendar not recently synchronized",
  };
  return map[reason];
}
