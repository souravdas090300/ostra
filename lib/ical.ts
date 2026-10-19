import ical, { type VEvent } from "node-ical";
import { formatInTimeZone } from "date-fns-tz";
import { FeedError } from "./ical-fetch";
import { TIMEZONE } from "./time";

export type Source = "AIRBNB" | "BOOKING_COM";
export type FeedEvent = { uid: string; startYmd: string; endYmd: string; summary: string };

const pad = (n: number) => String(n).padStart(2, "0");
const text = (v: unknown): string =>
  typeof v === "string" ? v : v && typeof v === "object" && "val" in v ? String((v as { val?: string }).val ?? "") : "";

function ymdOf(d: Date, dateOnly: boolean): string {
  // Date-only values: node-ical gives local midnight; the process runs with TZ=UTC so local == UTC.
  if (dateOnly) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return formatInTimeZone(d, TIMEZONE, "yyyy-MM-dd");
}

/** Pure function: .ics text -> normalised stays. Throws FeedError if it is not a calendar. */
export function parseFeed(raw: string): FeedEvent[] {
  if (!/BEGIN:VCALENDAR/i.test(raw)) throw new FeedError("The link did not return a calendar.");
  let data: ReturnType<typeof ical.sync.parseICS>;
  try {
    data = ical.sync.parseICS(raw);
  } catch {
    throw new FeedError("The calendar file could not be read.");
  }
  const out: FeedEvent[] = [];
  for (const item of Object.values(data)) {
    if (!item || item.type !== "VEVENT") continue;
    const ev = item as VEvent;
    const uid = text(ev.uid);
    if (!uid || !ev.start || !ev.end) continue;
    if (String((ev as { status?: string }).status ?? "").toUpperCase() === "CANCELLED") continue;
    const dateOnly = (ev as { datetype?: string })?.datetype === "date" || (ev.start as { dateOnly?: boolean })?.dateOnly === true;
    const startYmd = ymdOf(ev.start, dateOnly);
    const endYmd = ymdOf(ev.end, dateOnly);
    if (endYmd <= startYmd) continue; // zero or negative length
    out.push({ uid, startYmd, endYmd, summary: text(ev.summary) });
  }
  return out;
}

/** Airbnb marks host blocks "Airbnb (Not available)". Booking.com cannot be distinguished. */
export function isBlockEvent(source: Source, summary: string): boolean {
  return source === "AIRBNB" && /not available/i.test(summary);
}
