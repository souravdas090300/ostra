# Ostra Phase 4: Calendar view and conflict detection

> **For Devin:** read `OSTRA_PLAN.md` (Phase 4) and this file. This file **replaces** Phase 4 in the plan where they differ. Complete **Phase 4 only**, in one PR, and meet every acceptance criterion in section 9. Assumes Phases 1-3 are merged (bookings are being imported, `Booking.isBlock` exists, `lib/time.ts` exports `TIMEZONE`, `maltaLocalToUtc`, `maltaYmd`). No schema changes in this phase.

## 0. Decisions that shape the code

1. **All logic uses Malta calendar dates (`YYYY-MM-DD` strings), not instants.** A stay occupies the nights `[inYmd, outYmd)`. A stay that checks out on the 8th and one that checks in on the 8th do not overlap. String comparison works because the format sorts lexicographically. Use `maltaYmd(booking.checkIn)` / `maltaYmd(booking.checkOut)` to get the dates. Never use `new Date()` arithmetic on days (daylight saving); use the helpers in `lib/dates.ts`.
2. **Blocks are not stays.** A block (`isBlock = true`) is drawn greyed behind bookings and is **never** a conflict, never a turnover, and never counted as a guest. A block overlapping a booking is normal (Airbnb mirrors Booking.com stays as "Not available" when the platforms are linked), so it is **not flagged**.
3. **Cancelled bookings are hidden** everywhere in this phase.
4. **The calendar is a timeline**: one row per apartment, one column per day, bars start in the middle of the check-in day and end in the middle of the check-out day, so a same-day turnover visibly touches.
5. **Colour is never the only signal.** Each bar carries a source letter (A = Airbnb, B = Booking.com, D = Direct) and the legend names them.
6. **Every query is scoped by owner** (`apartment: { ownerId }`), with queries in `lib/calendar-data.ts` so they can be tested.
7. UI text is English for now; the host-language setting only affects guest messages in later phases.

## 1. Files to create

```
src/lib/dates.ts            # date-string helpers
src/lib/conflicts.ts        # double bookings, turnovers, missing contacts, day summary
src/lib/feed-health.ts      # stale / failing / never-synced feeds
src/lib/timeline.ts         # lanes + bar geometry
src/lib/calendar-view.ts    # builds the view model for the timeline
src/lib/calendar-data.ts    # owner-scoped queries
src/app/(app)/calendar/page.tsx
src/components/Timeline.tsx            # client
src/components/TodayPanel.tsx
src/components/AttentionPanel.tsx
tests/dates.test.ts  tests/conflicts.test.ts  tests/timeline.test.ts
tests/feed-health.test.ts  tests/calendar-data.test.ts
prisma/seed.ts              # extended (section 8)
```

## 2. `src/lib/dates.ts`

```ts
import { maltaYmd } from "./time";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isValidYmd(s: string): boolean {
  if (!YMD.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Day arithmetic on date strings, done in UTC so daylight saving cannot interfere. */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export const todayMalta = (now: Date = new Date()): string => maltaYmd(now);

export const eachDay = (from: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => addDays(from, i));

/** 0 = Sunday ... 6 = Saturday */
export const weekday = (ymd: string): number => new Date(`${ymd}T00:00:00Z`).getUTCDay();

/** Accept ?from=YYYY-MM-DD only if it is a real date within two years of today. */
export function parseFromParam(raw: string | undefined, today: string): string | null {
  if (!raw || !isValidYmd(raw)) return null;
  return Math.abs(diffDays(today, raw)) > 730 ? null : raw;
}

export function formatYmd(ymd: string, withWeekday = true): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: withWeekday ? "short" : undefined,
    day: "numeric", month: "short", timeZone: "UTC",
  });
}

export function timeAgo(then: Date, now: Date = new Date()): string {
  const mins = Math.max(0, Math.round((now.getTime() - then.getTime()) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}
```

## 3. `src/lib/conflicts.ts` (pure functions, no database)

```ts
import { addDays } from "./dates";

export type SourceName = "AIRBNB" | "BOOKING_COM" | "DIRECT";

export type Stay = {
  id: string;
  apartmentId: string;
  source: SourceName;
  isBlock: boolean;
  inYmd: string;          // Malta date of check-in
  outYmd: string;         // Malta date of check-out
  checkIn: Date;          // instant, used only for turnover gap hours
  checkOut: Date;
  guestName: string | null;
  guestPhone: string | null;
};

export type DoubleBooking = {
  apartmentId: string; a: Stay; b: Stay; overlapFrom: string; overlapTo: string;
};
export type Turnover = {
  apartmentId: string; outgoing: Stay; incoming: Stay; date: string; gapHours: number; tight: boolean;
};

export const TIGHT_TURNOVER_HOURS = 3;

const byApartment = (stays: Stay[]) => {
  const m = new Map<string, Stay[]>();
  for (const s of stays) {
    if (s.isBlock) continue; // blocks never take part in conflicts
    (m.get(s.apartmentId) ?? m.set(s.apartmentId, []).get(s.apartmentId)!).push(s);
  }
  return m;
};

/** Two stays in the same apartment whose nights overlap. Back-to-back stays do not overlap. */
export function findDoubleBookings(stays: Stay[]): DoubleBooking[] {
  const out: DoubleBooking[] = [];
  for (const [apartmentId, list] of byApartment(stays)) {
    const sorted = [...list].sort((x, y) => x.inYmd.localeCompare(y.inYmd) || x.id.localeCompare(y.id));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length && sorted[j].inYmd < sorted[i].outYmd; j++) {
        const a = sorted[i], b = sorted[j];
        out.push({
          apartmentId, a, b,
          overlapFrom: b.inYmd > a.inYmd ? b.inYmd : a.inYmd,
          overlapTo: a.outYmd < b.outYmd ? a.outYmd : b.outYmd,
        });
      }
    }
  }
  return out;
}

/** A check-out and a check-in on the same date in the same apartment. */
export function findTurnovers(stays: Stay[]): Turnover[] {
  const out: Turnover[] = [];
  for (const [apartmentId, list] of byApartment(stays)) {
    const arrivalsByDate = new Map<string, Stay[]>();
    for (const s of list) (arrivalsByDate.get(s.inYmd) ?? arrivalsByDate.set(s.inYmd, []).get(s.inYmd)!).push(s);
    for (const outgoing of list) {
      for (const incoming of arrivalsByDate.get(outgoing.outYmd) ?? []) {
        if (incoming.id === outgoing.id) continue;
        const gapHours = (incoming.checkIn.getTime() - outgoing.checkOut.getTime()) / 3_600_000;
        out.push({
          apartmentId, outgoing, incoming, date: outgoing.outYmd, gapHours,
          tight: gapHours < TIGHT_TURNOVER_HOURS,
        });
      }
    }
  }
  return out;
}

/** Guest arrivals in the next N days that have no phone number, so automatic messages cannot send. */
export function findMissingContacts(stays: Stay[], today: string, withinDays = 7): Stay[] {
  const last = addDays(today, withinDays);
  return stays
    .filter((s) => !s.isBlock && !s.guestPhone && s.inYmd >= today && s.inYmd <= last)
    .sort((a, b) => a.inYmd.localeCompare(b.inYmd));
}

export type DaySummary = {
  arrivals: Stay[]; departures: Stay[]; inHouse: Stay[]; turnoverApartments: Set<string>;
};

export function daySummary(stays: Stay[], ymd: string): DaySummary {
  const real = stays.filter((s) => !s.isBlock);
  const arrivals = real.filter((s) => s.inYmd === ymd);
  const departures = real.filter((s) => s.outYmd === ymd);
  const inHouse = real.filter((s) => s.inYmd < ymd && s.outYmd > ymd);
  const turnoverApartments = new Set(
    arrivals.map((a) => a.apartmentId).filter((id) => departures.some((d) => d.apartmentId === id)),
  );
  return { arrivals, departures, inHouse, turnoverApartments };
}
```

## 4. `src/lib/feed-health.ts`

```ts
export const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

export type FeedHealthInput = {
  id: string; apartmentId: string; apartmentName: string; source: string;
  lastSyncAt: Date | null; lastSuccessAt: Date | null; lastError: string | null;
};
export type FeedIssue = {
  feedId: string; apartmentId: string; apartmentName: string; source: string;
  kind: "never" | "error" | "stale"; detail?: string; since?: Date;
};

/** One issue per feed at most: error beats never beats stale. */
export function feedIssues(feeds: FeedHealthInput[], now: Date = new Date()): FeedIssue[] {
  const out: FeedIssue[] = [];
  for (const f of feeds) {
    const base = { feedId: f.id, apartmentId: f.apartmentId, apartmentName: f.apartmentName, source: f.source };
    if (f.lastError) out.push({ ...base, kind: "error", detail: f.lastError, since: f.lastSuccessAt ?? undefined });
    else if (!f.lastSuccessAt) out.push({ ...base, kind: "never" });
    else if (now.getTime() - f.lastSuccessAt.getTime() > STALE_AFTER_MS)
      out.push({ ...base, kind: "stale", since: f.lastSuccessAt });
  }
  return out;
}
```

## 5. Timeline maths: `src/lib/timeline.ts`

```ts
import { diffDays } from "./dates";
import type { Stay } from "./conflicts";

/** Greedy lane packing: stays that touch (out == next in) share a lane; overlapping stays get separate lanes. */
export function assignLanes(stays: Pick<Stay, "id" | "inYmd" | "outYmd">[]) {
  const sorted = [...stays].sort(
    (a, b) => a.inYmd.localeCompare(b.inYmd) || a.outYmd.localeCompare(b.outYmd) || a.id.localeCompare(b.id),
  );
  const laneEnds: string[] = [];
  const lanes = new Map<string, number>();
  for (const s of sorted) {
    let lane = laneEnds.findIndex((end) => end <= s.inYmd);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(s.outYmd); } else laneEnds[lane] = s.outYmd;
    lanes.set(s.id, lane);
  }
  return { lanes, laneCount: Math.max(1, laneEnds.length) };
}

export type Geometry = { left: number; width: number; continuesLeft: boolean; continuesRight: boolean };

/**
 * Positions are in "day units" from the first visible day. A stay starts at the middle of its
 * check-in day (+0.5) and ends at the middle of its check-out day (+0.5). Returns null if not visible.
 */
export function barGeometry(stay: Pick<Stay, "inYmd" | "outYmd">, from: string, days: number): Geometry | null {
  const start = diffDays(from, stay.inYmd) + 0.5;
  const end = diffDays(from, stay.outYmd) + 0.5;
  if (end <= 0 || start >= days) return null;
  const left = Math.max(0, start);
  const right = Math.min(days, end);
  return { left, width: right - left, continuesLeft: start < 0, continuesRight: end > days };
}
```

## 6. View model: `src/lib/calendar-view.ts`

```ts
import { diffDays } from "./dates";
import type { Stay, Turnover } from "./conflicts";
import { assignLanes, barGeometry } from "./timeline";

export const SOURCE_LABEL = { AIRBNB: "Airbnb", BOOKING_COM: "Booking.com", DIRECT: "Direct" } as const;
export const SOURCE_LETTER = { AIRBNB: "A", BOOKING_COM: "B", DIRECT: "D" } as const;

export type BarVM = {
  id: string; source: Stay["source"]; isBlock: boolean;
  inYmd: string; outYmd: string; nights: number;
  label: string; guestName: string | null; guestPhone: string | null;
  left: number; width: number; lane: number;
  continuesLeft: boolean; continuesRight: boolean; doubleBooked: boolean;
};
export type RowVM = {
  apartmentId: string; name: string; laneCount: number;
  bars: BarVM[]; blocks: BarVM[];
  turnovers: { dayIndex: number; gapHours: number; tight: boolean }[];
};

export function buildRows(a: {
  apartments: { id: string; name: string }[]; stays: Stay[]; from: string; days: number;
  doubleIds: Set<string>; turnovers: Turnover[];
}): RowVM[] {
  return a.apartments.map((apt) => {
    const mine = a.stays.filter((s) => s.apartmentId === apt.id);
    const real = mine.filter((s) => !s.isBlock);
    const { lanes, laneCount } = assignLanes(real);

    const toBar = (s: Stay, lane: number): BarVM | null => {
      const g = barGeometry(s, a.from, a.days);
      if (!g) return null;
      return {
        id: s.id, source: s.source, isBlock: s.isBlock,
        inYmd: s.inYmd, outYmd: s.outYmd, nights: diffDays(s.inYmd, s.outYmd),
        label: s.isBlock ? "Blocked" : s.guestName ?? SOURCE_LABEL[s.source],
        guestName: s.guestName, guestPhone: s.guestPhone,
        ...g, lane, doubleBooked: a.doubleIds.has(s.id),
      };
    };

    return {
      apartmentId: apt.id, name: apt.name, laneCount,
      bars: real.map((s) => toBar(s, lanes.get(s.id) ?? 0)).filter((b): b is BarVM => !!b),
      blocks: mine.filter((s) => s.isBlock).map((s) => toBar(s, 0)).filter((b): b is BarVM => !!b),
      turnovers: a.turnovers
        .filter((t) => t.apartmentId === apt.id)
        .map((t) => ({ dayIndex: diffDays(a.from, t.date), gapHours: t.gapHours, tight: t.tight }))
        .filter((t) => t.dayIndex >= 0 && t.dayIndex < a.days),
    };
  });
}
```

## 7. Data access: `src/lib/calendar-data.ts`

```ts
import { prisma } from "./db";
import { maltaLocalToUtc, maltaYmd } from "./time";
import { addDays } from "./dates";
import type { Stay } from "./conflicts";

const select = {
  id: true, apartmentId: true, source: true, isBlock: true,
  checkIn: true, checkOut: true, guestName: true, guestPhone: true,
} as const;

const toStay = (b: {
  id: string; apartmentId: string; source: Stay["source"]; isBlock: boolean;
  checkIn: Date; checkOut: Date; guestName: string | null; guestPhone: string | null;
}): Stay => ({ ...b, inYmd: maltaYmd(b.checkIn), outYmd: maltaYmd(b.checkOut) });

/** Confirmed bookings and blocks of this owner that touch [fromYmd, toYmd). toYmd is exclusive. */
export async function loadStays(ownerId: string, fromYmd: string, toYmd: string): Promise<Stay[]> {
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

export async function loadCalendarData(ownerId: string, from: string, days: number, today: string) {
  const to = addDays(from, days);
  const [apartments, viewStays, upcomingStays, feeds] = await Promise.all([
    prisma.apartment.findMany({
      where: { ownerId }, orderBy: { name: "asc" }, select: { id: true, name: true },
    }),
    loadStays(ownerId, from, to),
    loadStays(ownerId, addDays(today, -1), addDays(today, 90)), // attention window, independent of the view
    prisma.calendarFeed.findMany({
      where: { apartment: { ownerId } },
      select: {
        id: true, apartmentId: true, source: true, lastSyncAt: true, lastSuccessAt: true, lastError: true,
        apartment: { select: { name: true } },
      },
    }),
  ]);
  return {
    apartments, viewStays, upcomingStays,
    feeds: feeds.map((f) => ({
      id: f.id, apartmentId: f.apartmentId, apartmentName: f.apartment.name, source: f.source as string,
      lastSyncAt: f.lastSyncAt, lastSuccessAt: f.lastSuccessAt, lastError: f.lastError,
    })),
  };
}
```

## 8. UI

### `src/app/(app)/calendar/page.tsx`
```tsx
import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadCalendarData } from "@/lib/calendar-data";
import { addDays, eachDay, parseFromParam, todayMalta, formatYmd } from "@/lib/dates";
import { findDoubleBookings, findTurnovers, findMissingContacts } from "@/lib/conflicts";
import { feedIssues } from "@/lib/feed-health";
import { buildRows } from "@/lib/calendar-view";
import { Timeline } from "@/components/Timeline";
import { TodayPanel } from "@/components/TodayPanel";
import { AttentionPanel } from "@/components/AttentionPanel";

export default async function CalendarPage({
  searchParams,
}: { searchParams: Promise<{ from?: string; days?: string }> }) {
  const owner = await requireOwner();
  const sp = await searchParams;
  const now = new Date();
  const today = todayMalta(now);
  const days = sp.days === "28" ? 28 : 14;
  const from = parseFromParam(sp.from, today) ?? today;

  const data = await loadCalendarData(owner.id, from, days, today);

  if (data.apartments.length === 0) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Calendar</h1>
        <p className="text-gray-600">
          Add your first apartment to start. <Link className="underline" href="/apartments/new">Add apartment</Link>
        </p>
      </div>
    );
  }

  const doubleIds = new Set(findDoubleBookings(data.viewStays).flatMap((d) => [d.a.id, d.b.id]));
  const rows = buildRows({
    apartments: data.apartments, stays: data.viewStays, from, days,
    doubleIds, turnovers: findTurnovers(data.viewStays),
  });

  const nameOf = new Map(data.apartments.map((a) => [a.id, a.name]));
  const href = (f: string) => `/calendar?from=${f}&days=${days}`;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Calendar</h1>

      <TodayPanel
        today={today} tomorrow={addDays(today, 1)}
        stays={data.upcomingStays} apartmentNames={Object.fromEntries(nameOf)}
      />

      <AttentionPanel
        apartmentNames={Object.fromEntries(nameOf)}
        doubles={findDoubleBookings(data.upcomingStays)}
        missing={findMissingContacts(data.upcomingStays, today)}
        feedIssues={feedIssues(data.feeds, now).map((i) => ({ ...i, since: i.since?.toISOString() }))}
        now={now.toISOString()}
      />

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-gray-600">{formatYmd(from)} to {formatYmd(addDays(from, days - 1))}</p>
          <nav className="flex items-center gap-2 text-sm">
            <Link className="rounded border px-3 py-1.5" href={href(addDays(from, -days))}>Previous</Link>
            <Link className="rounded border px-3 py-1.5" href={href(today)}>Today</Link>
            <Link className="rounded border px-3 py-1.5" href={href(addDays(from, days))}>Next</Link>
            <Link className="rounded border px-3 py-1.5" href={`/calendar?from=${from}&days=${days === 14 ? 28 : 14}`}>
              {days === 14 ? "4 weeks" : "2 weeks"}
            </Link>
          </nav>
        </div>
        <Timeline days={eachDay(from, days)} today={today} rows={rows} />
        <Legend />
      </section>
    </div>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-3 text-xs text-gray-600">
      <li>A = Airbnb</li><li>B = Booking.com</li><li>D = Direct</li>
      <li>Grey striped = blocked dates</li>
      <li>Red outline = double booking</li>
      <li>Amber marker = same-day turnover</li>
    </ul>
  );
}
```

### `src/components/Timeline.tsx` (client)
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { BarVM, RowVM } from "@/lib/calendar-view";
import { SOURCE_LABEL, SOURCE_LETTER } from "@/lib/calendar-view";
import { formatYmd, weekday } from "@/lib/dates";

const CELL = 44;       // px per day
const NAME_W = 112;    // px, sticky apartment column
const LANE_H = 30;

const COLORS: Record<string, string> = {
  AIRBNB: "bg-rose-100 border-rose-400 text-rose-900",
  BOOKING_COM: "bg-blue-100 border-blue-400 text-blue-900",
  DIRECT: "bg-emerald-100 border-emerald-400 text-emerald-900",
};

export function Timeline({ days, today, rows }: { days: string[]; today: string; rows: RowVM[] }) {
  const [selected, setSelected] = useState<BarVM | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const n = days.length;

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (selected && !d.open) d.showModal();
    if (!selected && d.open) d.close();
  }, [selected]);

  const pct = (units: number) => `${(units / n) * 100}%`;

  return (
    <>
      <div className="overflow-x-auto rounded-md border bg-white">
        <div style={{ minWidth: NAME_W + n * CELL }}>
          {/* Header */}
          <div className="flex border-b text-center text-xs">
            <div className="sticky left-0 z-20 shrink-0 border-r bg-white" style={{ width: NAME_W }} />
            {days.map((d) => {
              const wd = weekday(d);
              return (
                <div
                  key={d}
                  className={`shrink-0 py-1 ${wd === 0 || wd === 6 ? "bg-gray-50" : ""} ${d === today ? "bg-amber-50 font-semibold" : ""}`}
                  style={{ width: CELL }}
                >
                  <div className="text-gray-500">{formatYmd(d).split(" ")[0]}</div>
                  <div>{Number(d.slice(8))}</div>
                </div>
              );
            })}
          </div>

          {/* Rows */}
          {rows.map((row) => (
            <div key={row.apartmentId} className="flex border-b last:border-b-0">
              <div
                className="sticky left-0 z-20 shrink-0 border-r bg-white p-2 text-sm font-medium"
                style={{ width: NAME_W }}
              >
                <span className="line-clamp-2">{row.name}</span>
              </div>
              <div
                className="relative shrink-0"
                style={{
                  width: n * CELL,
                  height: row.laneCount * LANE_H + 8,
                  backgroundImage: "linear-gradient(to right, #e5e7eb 1px, transparent 1px)",
                  backgroundSize: `${CELL}px 100%`,
                }}
              >
                {days.map((d, i) => {
                  const wd = weekday(d);
                  if (d !== today && wd !== 0 && wd !== 6) return null;
                  return (
                    <div
                      key={d}
                      className={`absolute inset-y-0 ${d === today ? "bg-amber-50" : "bg-gray-50"}`}
                      style={{ left: pct(i), width: pct(1) }}
                    />
                  );
                })}

                {/* Blocks sit behind bookings */}
                {row.blocks.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setSelected(b)}
                    aria-label={`Blocked ${formatYmd(b.inYmd)} to ${formatYmd(b.outYmd)}`}
                    className="absolute inset-y-0 border-x border-gray-300 opacity-80"
                    style={{
                      left: pct(b.left), width: pct(b.width),
                      backgroundImage:
                        "repeating-linear-gradient(45deg,#e5e7eb,#e5e7eb 6px,#f3f4f6 6px,#f3f4f6 12px)",
                    }}
                  />
                ))}

                {row.bars.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setSelected(b)}
                    aria-label={`${SOURCE_LABEL[b.source]} booking, ${b.label}, ${formatYmd(b.inYmd)} to ${formatYmd(b.outYmd)}, ${b.nights} nights${b.doubleBooked ? ", double booked" : ""}`}
                    className={`absolute flex items-center gap-1 overflow-hidden border px-1 text-left text-xs ${COLORS[b.source]} ${
                      b.doubleBooked ? "ring-2 ring-red-600" : ""
                    } ${b.continuesLeft ? "rounded-l-none" : "rounded-l-md"} ${b.continuesRight ? "rounded-r-none" : "rounded-r-md"}`}
                    style={{
                      left: pct(b.left), width: pct(b.width),
                      top: 4 + b.lane * LANE_H, height: LANE_H - 4,
                    }}
                  >
                    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/70 text-[10px] font-bold">
                      {SOURCE_LETTER[b.source]}
                    </span>
                    {b.doubleBooked && <span aria-hidden>⚠</span>}
                    <span className="truncate">{b.label}</span>
                  </button>
                ))}

                {row.turnovers.map((t) => (
                  <div
                    key={t.dayIndex}
                    title={`Same-day turnover (${t.gapHours.toFixed(1)} h between check-out and check-in)`}
                    className={`pointer-events-none absolute inset-y-0 w-0.5 ${t.tight ? "bg-red-500" : "bg-amber-500"}`}
                    style={{ left: pct(t.dayIndex + 0.5) }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <dialog
        ref={dialog}
        onClose={() => setSelected(null)}
        className="w-[min(92vw,26rem)] rounded-lg p-0 backdrop:bg-black/40"
      >
        {selected && (
          <div className="space-y-3 p-4">
            <h2 className="text-lg font-semibold">{selected.isBlock ? "Blocked dates" : selected.label}</h2>
            <dl className="space-y-1 text-sm">
              <div><dt className="inline text-gray-500">Source: </dt><dd className="inline">{SOURCE_LABEL[selected.source]}</dd></div>
              <div><dt className="inline text-gray-500">Dates: </dt><dd className="inline">{formatYmd(selected.inYmd)} to {formatYmd(selected.outYmd)} ({selected.nights} nights)</dd></div>
              {!selected.isBlock && (
                <div>
                  <dt className="inline text-gray-500">Guest phone: </dt>
                  <dd className="inline">{selected.guestPhone ?? "none yet. Automatic messages will not send."}</dd>
                </div>
              )}
            </dl>
            {selected.doubleBooked && (
              <p className="rounded bg-red-50 p-2 text-sm text-red-800">
                This stay overlaps another booking in the same apartment. Contact one guest or the platform now.
              </p>
            )}
            {selected.isBlock && (
              <p className="text-sm text-gray-600">Dates closed on the platform. They are not available to sell.</p>
            )}
            <button className="rounded-md bg-black px-3 py-2 text-sm text-white" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
        )}
      </dialog>
    </>
  );
}
```

### `src/components/TodayPanel.tsx` (server component)
Two cards, **Today** and **Tomorrow**, built from `daySummary(stays, ymd)`:
- Header with the date, then counts: "2 arriving, 1 leaving, 3 staying".
- Lists: **Arrivals**, **Departures**, each item `Apartment name: guest name or source label (source)`.
- A **Same-day turnover** badge for every apartment in `turnoverApartments`, with the gap from `findTurnovers` (red when `tight`).
- Empty state: "Nothing today".
Props: `today`, `tomorrow`, `stays: Stay[]`, `apartmentNames: Record<string, string>`. Date objects in `stays` are serialisable by Next.js between server components; do not pass them to client components without converting to strings.

### `src/components/AttentionPanel.tsx` (server component)
Renders nothing when there are no items; otherwise a card titled **Needs attention** with items sorted by severity:
1. **Double bookings (red).** `Apartment: Airbnb booking and Booking.com booking overlap 12 to 15 Mar`, with a link to `/calendar?from=<overlapFrom minus 1 day>`.
2. **Feed problems (amber).** `error`: "Apartment (Airbnb): calendar sync problem: <detail>". `never`: "has not synced yet". `stale`: "last synced 5 h ago" (`timeAgo`). Each links to `/apartments/<apartmentId>`.
3. **Missing phone numbers (amber).** `Apartment: arrival Tue 3 Nov (Airbnb) has no phone number, so automatic messages will not send`, linking to `/calendar?from=<inYmd minus 1 day>`.
Cap each group at 5 items with "and N more". Pass dates to this component as ISO strings (it is rendered on the server but keep props plain objects).

### Seed data (`prisma/seed.ts`, extend)
Use `todayMalta()`, `addDays` and `maltaLocalToUtc` so the scenarios are always relative to today, for the first apartment (a, b, c = the three seeded apartments):
- **Double booking** in apartment A: Airbnb stay `today+3 .. today+6` and Booking.com stay `today+5 .. today+8`.
- **Same-day turnover (4 h gap)** in apartment B: Airbnb `today+1 .. today+4`, direct `today+4 .. today+7`.
- **Tight turnover (1 h gap)** in apartment C: set its check-out time 14:00 and check-in time 15:00, stays `today-2 .. today+2` and `today+2 .. today+5`.
- **Block** in apartment B: `today+10 .. today+13` (`isBlock: true`).
- **Mirrored block** overlapping a booking in apartment C: block `today+2 .. today+5` over the second stay (must not be flagged).
- **Missing phone**: one arrival in 3 days without `guestPhone`.
- **Stale feed**: one feed with `lastSuccessAt` 5 hours ago; one feed with `lastError` set; one never synced.
Seed must be idempotent (delete and recreate the owner's bookings and feeds when re-run).

## 9. Tests and acceptance

**Unit tests (no database)**
- `dates`: `addDays("2026-10-31", 1) = "2026-11-01"`; across the October clock change (`2026-10-24` + 3 = `2026-10-27`) and the March one; leap day; `diffDays` symmetric; `isValidYmd("2026-02-30")` false; `parseFromParam` rejects garbage and dates over two years away.
- `findDoubleBookings`: overlap by one night is found; **back-to-back stays are not**; identical dates are found; three mutually overlapping stays give three pairs; a stay containing another is found; **different apartments never conflict**; **blocks never conflict** (block over booking, block over block); cancelled stays are not passed in; overlap range is correct.
- `findTurnovers`: same-day detected with the right `gapHours` (check-out 11:00 and check-in 15:00 gives 4); `tight` below 3 h; none across apartments; blocks ignored; non-adjacent days not flagged.
- `findMissingContacts`: includes arrivals today and in 7 days, excludes day 8, past arrivals, blocks, and bookings with a phone.
- `daySummary`: arrivals, departures, in-house (not counting the arrivals and departures of that day), turnover apartments.
- `assignLanes`: touching stays share a lane; overlapping stays use two lanes; `laneCount` at least 1 with no stays.
- `barGeometry`: stay inside the window; checks out on the first visible day (`left 0`, `width 0.5`, not continuing right); starts on the last visible day (`width 0.5`); starts before the window (`continuesLeft`); ends after the window (`continuesRight`); fully outside returns `null`; a stay ending on `from - 1` returns `null`.
- `feedIssues`: error beats never beats stale; exactly three hours is not stale, three hours and one minute is; healthy feed gives none.

**Database tests (`tests/calendar-data.test.ts`, test database)**
- `loadStays` returns only the owner's bookings (create a second owner with bookings; they must not appear), hides `CANCELLED`, **includes** a stay that checks out on the `from` day, **excludes** a stay that checks in on the `to` day, includes blocks, and `loadCalendarData` returns the owner's feeds only.
- The Malta date conversion is exact around daylight saving: a stay stored from `maltaLocalToUtc("2026-10-24","15:00")` to `maltaLocalToUtc("2026-10-27","11:00")` yields `inYmd "2026-10-24"` and `outYmd "2026-10-27"`.

**Manual check**
- Open `/calendar` at a 390 px wide viewport: the apartment column stays visible while the grid scrolls sideways; the page body itself never scrolls sideways; tap targets open the sheet; the sheet closes with the button and the Escape key.
- With the seed data, the double booking is outlined in red with the warning icon and appears in **Needs attention**; the 4 h turnover shows an amber marker and the 1 h turnover a red marker; the mirrored block under a booking is not flagged; stale, error and never-synced feeds each show the right message.

**Acceptance criteria**
- `/calendar` shows all apartments side by side for 2 or 4 weeks, with previous, next and today navigation that survives reloads (`?from=`, `?days=`), and rejects invalid parameters by falling back to defaults.
- Bars are coloured by source and also marked A, B or D; blocks are striped; cancelled bookings never appear.
- Double bookings are flagged on the bar and listed in **Needs attention** with both sources named; back-to-back stays and blocks are never flagged.
- Same-day turnovers show a marker with the gap, red when under 3 hours.
- The **Today** panel shows arrivals, departures and turnovers for today and tomorrow in Malta time, including in the minutes after midnight Malta time (test with an injected `now`).
- Missing phone numbers (next 7 days) and unhealthy feeds are listed with links to fix them.
- Every query is owner-scoped (tested); nothing from another owner can appear.
- Usable at 390 px width; bars are focusable buttons with descriptive labels.
- `npm run lint`, `typecheck`, `test`, `build` pass.

## 10. What is deliberately not in this phase
- Editing bookings (Phase 5), the booking detail page (Phase 5), drag and drop, and a month grid.
- Cleaner and housekeeping scheduling.
- Moving or resolving a double booking inside Ostra. The host must resolve it on Airbnb or Booking.com; Ostra only warns.
