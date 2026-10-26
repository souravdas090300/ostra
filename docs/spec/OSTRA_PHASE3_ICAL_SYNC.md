# Ostra Phase 3: iCal sync (Airbnb + Booking.com) on Railway

> **For Devin:** read `OSTRA_PLAN.md` (Phase 3) and this file. This file **replaces** Phase 3 in the plan where they differ. Complete **Phase 3 only**, in one PR, and meet every acceptance criterion in section 9. Assumes Phases 1 and 2 are merged.

## 0. Corrections to the original plan (read first)

1. **Do not skip "blocked" events.** A date the host blocked on Airbnb is *not sellable*, so it must block availability. Import it as a booking with `isBlock = true`. Blocks appear greyed in the calendar, get no guest messages, and are not counted as stays.
2. **Booking.com's feed does not distinguish reservations from closures.** Its events typically all read like "CLOSED - Not available", so for `BOOKING_COM` every event is imported as a real booking (`isBlock = false`). Airbnb reservations typically read "Reserved" and blocks read "Airbnb (Not available)". **Verify these summaries with your friend's real feeds** before relying on them.
3. **Never store or log the feed URL contents beyond what is needed.** Airbnb's `DESCRIPTION` field can contain a reservation link and part of a phone number. Ignore `DESCRIPTION` entirely and never store raw `.ics` text.
4. **Run everything with `TZ=UTC`** (Railway variable, tests, local dev). Date-only values from `node-ical` come back as local-midnight dates, and this makes them deterministic.
5. Hosting is **Railway** (app + Postgres + cron services), not Vercel Cron.

## 1. Dependencies and config

```bash
npm i undici date-fns date-fns-tz
npm i -D cross-env
```
`package.json`:
```json
"test": "cross-env TZ=UTC vitest run",
"dev": "cross-env TZ=UTC next dev"
```
Railway variables on every service: `TZ=UTC`, `CRON_SECRET`, `DATABASE_URL`.

`src/lib/time.ts`
```ts
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";

export const TIMEZONE = "Europe/Malta";

/** "2026-11-05" + "15:00" in Malta time -> UTC Date. Handles daylight saving. */
export function maltaLocalToUtc(ymd: string, hhmm: string): Date {
  return fromZonedTime(`${ymd}T${hhmm}:00`, TIMEZONE);
}

export function maltaYmd(d: Date): string {
  return formatInTimeZone(d, TIMEZONE, "yyyy-MM-dd");
}
```

## 2. Schema changes (migration `phase3_ical_sync`)

```prisma
model CalendarFeed {
  // add:
  lastSuccessAt DateTime?
  bookings      Booking[]
}

model Booking {
  // add:
  isBlock        Boolean       @default(false)  // host-blocked dates, not a guest stay
  calendarFeedId String?
  calendarFeed   CalendarFeed? @relation(fields: [calendarFeedId], references: [id], onDelete: SetNull)
  @@index([calendarFeedId])
}
```
`lastSyncAt` = last attempt, `lastSuccessAt` = last successful sync (used to show "stale" warnings).

## 3. Safe feed fetching: `src/lib/ical-fetch.ts`

Feed URLs are user-supplied, so fetching them is a server-side request forgery risk. Defence: `isSafeFeedUrl` (Phase 2) on every URL including redirects, **and** an IP check at connection time (so DNS tricks cannot point a public name at an internal address).

```ts
import dns from "node:dns";
import net from "node:net";
import { Agent, fetch, type Response } from "undici";
import { isSafeFeedUrl } from "./validation";

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

/** Errors whose message is safe to show to the host. */
export class FeedError extends Error {}

export function isPrivateIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      a >= 224                              // multicast + reserved
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    return (
      x === "::1" || x === "::" ||
      x.startsWith("::ffff:") ||            // IPv4-mapped: reject outright
      /^fe[89ab]/.test(x) ||                // link-local
      x.startsWith("fc") || x.startsWith("fd") // unique local
    );
  }
  return true; // not an IP at all: treat as unsafe
}

const agent = new Agent({
  connect: {
    timeout: TIMEOUT_MS,
    // Validate the resolved addresses at connection time. Adjust typings if the compiler complains.
    lookup(hostname, options, callback) {
      dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
        if (err) return (callback as any)(err, "", 0);
        if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
          return (callback as any)(new Error("Blocked address"), "", 0);
        }
        if ((options as any).all) return (callback as any)(null, addrs);
        return (callback as any)(null, addrs[0].address, addrs[0].family);
      });
    },
  },
});

async function readLimited(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new FeedError("The calendar file is too large.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchFeedText(url: string): Promise<string> {
  let current = url;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    if (!isSafeFeedUrl(current)) throw new FeedError("This calendar link is not allowed.");
    let res: Response;
    try {
      res = await fetch(current, {
        dispatcher: agent,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "user-agent": "Ostra/1.0 (calendar sync)",
          accept: "text/calendar, text/plain, */*",
        },
      });
    } catch {
      throw new FeedError("Could not reach the calendar provider."); // never include the URL
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel();
      if (!loc) throw new FeedError("The calendar provider sent a bad redirect.");
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new FeedError(`The calendar provider returned an error (HTTP ${res.status}).`);
    }
    return readLimited(res);
  }
  throw new FeedError("Too many redirects.");
}
```

## 4. Parsing: `src/lib/ical.ts`

```ts
import ical, { type VEvent } from "node-ical";
import { formatInTimeZone } from "date-fns-tz";
import { FeedError } from "./ical-fetch";
import { TIMEZONE } from "./time";

export type Source = "AIRBNB" | "BOOKING_COM";
export type FeedEvent = { uid: string; startYmd: string; endYmd: string; summary: string };

const pad = (n: number) => String(n).padStart(2, "0");
const text = (v: unknown): string =>
  typeof v === "string" ? v : v && typeof v === "object" && "val" in v ? String((v as any).val ?? "") : "";

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
    if (String((ev as any).status ?? "").toUpperCase() === "CANCELLED") continue;
    const dateOnly = (ev as any).datetype === "date" || (ev.start as any).dateOnly === true;
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
```
Ignore recurring-event rules (RRULE); booking feeds do not use them.

## 5. Sync logic: `src/lib/sync.ts`

```ts
import { prisma } from "./db";
import { fetchFeedText, FeedError } from "./ical-fetch";
import { parseFeed, isBlockEvent } from "./ical";
import { maltaLocalToUtc, maltaYmd } from "./time";
import { rescheduleBookings } from "./schedule";

export type SyncResult = {
  feedId: string; ok: boolean; skipped?: boolean;
  created: number; updated: number; cancelled: number;
  warning?: string; error?: string;
};

const HISTORY_DAYS = 7; // ignore stays that ended more than a week ago

/** Never throws. Safe to call from cron, "Sync now" and when a link is added. */
export async function syncFeed(feedId: string, now = new Date()): Promise<SyncResult> {
  const base: SyncResult = { feedId, ok: false, created: 0, updated: 0, cancelled: 0 };
  const feed = await prisma.calendarFeed.findUnique({
    where: { id: feedId }, include: { apartment: true },
  });
  if (!feed) return { ...base, error: "Calendar link not found." };

  try {
    const events = parseFeed(await fetchFeedText(feed.icalUrl));
    const apt = feed.apartment;
    const cutoff = maltaYmd(new Date(now.getTime() - HISTORY_DAYS * 86_400_000));
    const relevant = events.filter((e) => e.endYmd >= cutoff);
    const changedIds: string[] = [];
    let warning: string | undefined;

    const result = await prisma.$transaction(async (tx) => {
      // Prevent two syncs of the same feed running together (cron + "Sync now").
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtext(${feed.id})) AS locked`;
      if (!locked) return { skipped: true, created: 0, updated: 0, cancelled: 0 };

      const existing = await tx.booking.findMany({
        where: {
          apartmentId: apt.id,
          OR: [
            { calendarFeedId: feed.id },
            { calendarFeedId: null, externalUid: { startsWith: `${feed.source}:` } },
          ],
        },
      });
      const byUid = new Map(existing.map((b) => [b.externalUid, b]));
      const seen = new Set<string>();
      let created = 0, updated = 0, cancelled = 0;

      for (const ev of relevant) {
        const externalUid = `${feed.source}:${ev.uid}`;
        seen.add(externalUid);
        const checkIn = maltaLocalToUtc(ev.startYmd, apt.checkInTime);
        const checkOut = maltaLocalToUtc(ev.endYmd, apt.checkOutTime);
        const isBlock = isBlockEvent(feed.source, ev.summary);
        const cur = byUid.get(externalUid);

        const unchanged =
          cur &&
          cur.checkIn.getTime() === checkIn.getTime() &&
          cur.checkOut.getTime() === checkOut.getTime() &&
          cur.status === "CONFIRMED" &&
          cur.isBlock === isBlock &&
          cur.calendarFeedId === feed.id;
        if (unchanged) continue;

        // Host-entered fields (guestName, guestPhone, guestLanguage) are never overwritten.
        const b = await tx.booking.upsert({
          where: { apartmentId_externalUid: { apartmentId: apt.id, externalUid } },
          create: {
            apartmentId: apt.id, source: feed.source, externalUid, calendarFeedId: feed.id,
            checkIn, checkOut, isBlock, status: "CONFIRMED",
          },
          update: { checkIn, checkOut, isBlock, status: "CONFIRMED", calendarFeedId: feed.id },
        });
        cur ? updated++ : created++;
        changedIds.push(b.id);
      }

      // Future bookings that vanished from the feed were cancelled on the platform.
      const missing = existing.filter(
        (b) => !seen.has(b.externalUid ?? "") && b.status === "CONFIRMED" && b.checkOut > now,
      );
      if (relevant.length === 0 && missing.length > 0) {
        // An empty feed is more likely a provider glitch than every booking being cancelled.
        warning = "The calendar returned no events, so existing bookings were kept.";
      } else if (missing.length > 0) {
        await tx.booking.updateMany({
          where: { id: { in: missing.map((m) => m.id) } },
          data: { status: "CANCELLED" },
        });
        cancelled = missing.length;
        changedIds.push(...missing.map((m) => m.id));
      }
      return { skipped: false, created, updated, cancelled };
    }, { timeout: 30_000 });

    if (result.skipped) return { ...base, ok: true, skipped: true };

    await prisma.calendarFeed.update({
      where: { id: feed.id },
      data: { lastSyncAt: now, lastSuccessAt: now, lastError: warning ?? null },
    });
    if (changedIds.length) await rescheduleBookings(changedIds); // Phase 6 fills this in
    return { ...base, ok: true, ...result, warning };
  } catch (e) {
    const message = e instanceof FeedError ? e.message : "Sync failed unexpectedly. Try again later.";
    if (!(e instanceof FeedError)) console.error("sync failed", { feedId }); // no URL, no stack with URL
    await prisma.calendarFeed.update({
      where: { id: feedId },
      data: { lastSyncAt: now, lastError: message }, // lastSuccessAt untouched, old bookings kept
    }).catch(() => {});
    return { ...base, error: message };
  }
}

export async function syncAllFeeds(concurrency = 3): Promise<SyncResult[]> {
  const feeds = await prisma.calendarFeed.findMany({ select: { id: true } });
  const results: SyncResult[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, feeds.length) }, async () => {
      while (i < feeds.length) results.push(await syncFeed(feeds[i++].id));
    }),
  );
  return results;
}
```

`src/lib/schedule.ts` (stub, Phase 6 implements it)
```ts
/** Called when bookings are created, changed or cancelled by sync. Phase 6 will reschedule messages. */
export async function rescheduleBookings(_bookingIds: string[]): Promise<void> {}
```

## 6. Cron endpoint and Railway

`src/app/api/cron/sync-calendars/route.ts`
```ts
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { syncAllFeeds } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed
  const a = Buffer.from(req.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const results = await syncAllFeeds();
  return NextResponse.json({
    feeds: results.length,
    failed: results.filter((r) => !r.ok).length,
    created: results.reduce((n, r) => n + r.created, 0),
    updated: results.reduce((n, r) => n + r.updated, 0),
    cancelled: results.reduce((n, r) => n + r.cancelled, 0),
  });
}
```
Only `POST` is exported, so `GET` returns 405. Make sure the Phase 1 middleware excludes `/api/cron/*` from the session check (these use `CRON_SECRET` instead).

`scripts/run-cron.mjs` (the cron service runs this and exits)
```js
const job = process.argv[2];
const { APP_URL, CRON_SECRET } = process.env;
if (!job || !APP_URL || !CRON_SECRET) {
  console.error("Usage: node scripts/run-cron.mjs <job>  (needs APP_URL and CRON_SECRET)");
  process.exit(1);
}
const res = await fetch(`${APP_URL}/api/cron/${job}`, {
  method: "POST",
  headers: { authorization: `Bearer ${CRON_SECRET}` },
  signal: AbortSignal.timeout(280_000),
});
console.log(job, res.status, await res.text());
process.exit(res.ok ? 0 : 1);
```

**Railway setup (manual, document in `docs/RUNBOOK.md`)**
1. In the same Railway project as the web service, add a **new service from the same repo**, named `cron-sync-calendars`.
2. Start command: `node scripts/run-cron.mjs sync-calendars`.
3. Cron schedule: `*/30 * * * *` (the schedule is evaluated in UTC; Railway's minimum interval is about 5 minutes, check their docs).
4. Variables: `APP_URL` (public https URL of the web service), `CRON_SECRET` (same value as the web service), `TZ=UTC`.
5. The job must exit when finished (the script does). A failed run exits with code 1 so it shows as failed in Railway.

## 7. Host-facing changes to Phase 2 code

**`syncFeedNow` server action** (`apartments/actions.ts`)
```ts
export async function syncFeedNow(feedId: string): Promise<{ ok: boolean; message: string }> {
  const owner = await requireOwner();
  const feed = await prisma.calendarFeed.findFirst({
    where: { id: feedId, apartment: { ownerId: owner.id } },
  });
  if (!feed) notFound();
  if (feed.lastSyncAt && Date.now() - feed.lastSyncAt.getTime() < 60_000) {
    return { ok: false, message: "Synced less than a minute ago." };
  }
  const r = await syncFeed(feedId);
  revalidatePath(`/apartments/${feed.apartmentId}`);
  return r.ok
    ? { ok: true, message: `Done: ${r.created} new, ${r.updated} changed, ${r.cancelled} cancelled.` }
    : { ok: false, message: r.error ?? "Sync failed." };
}
```

**`addFeed`**: after creating the feed, run `await syncFeed(feed.id)` immediately. If it fails, keep the feed but return `{ error: "Saved, but the first sync failed: <message>" }` so the host learns at once that the link is wrong.

**`removeFeed`**: replace with a version that keeps history instead of deleting bookings:
```ts
export async function removeFeed(feedId: string, apartmentId: string): Promise<void> {
  const owner = await requireOwner();
  const feed = await prisma.calendarFeed.findFirst({
    where: { id: feedId, apartment: { ownerId: owner.id } },
  });
  if (!feed) return;
  await prisma.$transaction([
    prisma.booking.updateMany({
      where: { calendarFeedId: feed.id, status: "CONFIRMED", checkOut: { gt: new Date() } },
      data: { status: "CANCELLED" },
    }),
    prisma.calendarFeed.delete({ where: { id: feed.id } }), // bookings keep history (SetNull)
  ]);
  revalidatePath(`/apartments/${apartmentId}`);
}
```
If the host adds the same link again, the next sync reactivates those bookings (the upsert resets them to CONFIRMED).

**`FeedManager` UI**
- Add a **Sync now** button per feed (client component with `useTransition`, shows the returned message).
- Show **"Last successful sync"** from `lastSuccessAt`; show an amber "stale" note if it is older than 3 hours, and `lastError` in red.
- Add a confirm before Remove: "This cancels this link's future bookings in Ostra. They stay on Airbnb/Booking.com."

## 8. Tests

**Fixtures** (`tests/fixtures/`)

`airbnb.ics`
```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Airbnb Inc//Hosting Calendar//EN
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261105
DTEND;VALUE=DATE:20261108
UID:abc123@airbnb.com
SUMMARY:Reserved
DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/XXXX\nPhone Number (Last 4 Digits): 1234
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261201
DTEND;VALUE=DATE:20261204
UID:blocked1@airbnb.com
SUMMARY:Airbnb (Not available)
END:VEVENT
END:VCALENDAR
```
`booking.ics` has one event `SUMMARY:CLOSED - Not available`, `UID:bk-1`, `DTSTART;VALUE=DATE:20261105`, `DTEND;VALUE=DATE:20261107`. Also create: `cancelled.ics` (one `STATUS:CANCELLED` event), `no-end.ics`, `bad-dates.ics` (end before start), `empty.ics` (calendar with no events), `not-a-calendar.txt`.

**Unit tests (`tests/ical.test.ts`, `tests/ical-fetch.test.ts`, `tests/time.test.ts`)**
- `parseFeed(airbnb)` gives `2026-11-05` to `2026-11-08` (pins the date-only behaviour; if it is off by one day, fix `ymdOf`, do not change the fixture).
- Airbnb "Not available" gives `isBlock` true; Airbnb "Reserved" false; Booking.com "CLOSED - Not available" false.
- Skips cancelled, missing end, end before start; throws `FeedError` for non-calendar text; `DESCRIPTION` content never appears in the output.
- `maltaLocalToUtc("2026-11-05","15:00")` is `14:00Z` (winter, UTC+1); `maltaLocalToUtc("2027-07-10","15:00")` is `13:00Z` (summer, UTC+2).
- `isPrivateIp`: true for `127.0.0.1`, `10.1.2.3`, `172.16.0.1`, `192.168.1.1`, `169.254.169.254`, `100.64.0.1`, `::1`, `fe80::1`, `fd00::1`, `::ffff:127.0.0.1`; false for `8.8.8.8`, `2606:4700:4700::1111`.

**Integration tests (`tests/sync.test.ts`, test database, `vi.mock("@/lib/ical-fetch")` to return fixture text)**
1. First sync creates bookings with the right UTC times for the apartment's check-in/out times, `source` correct, blocks flagged.
2. Syncing twice creates no duplicates (counts stay equal).
3. Changed dates in the feed update the booking.
4. A future event removed from the feed becomes `CANCELLED`; a past event removed is untouched.
5. An empty feed with existing future bookings cancels nothing and sets a warning in `lastError`.
6. A fetch failure keeps all bookings, sets `lastError` and `lastSyncAt`, leaves `lastSuccessAt` unchanged.
7. `guestPhone`, `guestName` and `guestLanguage` entered by the host survive a re-sync.
8. `DIRECT` bookings are never changed or cancelled by any sync.
9. Two apartments with the same event UID do not interfere.
10. `Promise.all([syncFeed(id), syncFeed(id)])` produces no duplicates or unique-constraint errors.
11. `removeFeed` cancels that feed's future bookings, keeps past ones, and deletes the feed; re-adding the link and syncing reactivates them.
12. `rescheduleBookings` is called with the ids of created, changed and cancelled bookings only.

**Cron route tests:** `401` with no header, wrong secret, and unset `CRON_SECRET`; `200` with the right secret; `GET` returns `405`.

## 9. Acceptance criteria

- Adding a real Airbnb or Booking.com link imports its bookings immediately; a bad link shows a clear error right away.
- Re-running sync is idempotent, and changed or cancelled bookings are reflected within one cycle.
- Host edits (name, phone, language) are never lost; `DIRECT` bookings are never touched.
- Feed failures never delete or cancel anything, and the UI shows last successful sync and errors.
- Private and internal addresses, redirects to them, non-https links, oversize files and slow servers are rejected.
- No feed URL or raw calendar text appears in logs, error messages or the database.
- The cron endpoint rejects unauthenticated calls; the Railway cron service is documented in `docs/RUNBOOK.md` and runs every 30 minutes.
- `npm run lint`, `typecheck`, `test`, `build` pass; the migration applies on a fresh database.

## 10. Manual check with your friend's real feeds (before closing the phase)

1. Add one real Airbnb link and one real Booking.com link on a test apartment.
2. Compare the imported bookings with the Airbnb and Booking.com apps for the next 30 days: dates, count, blocks.
3. Look at the summary text each platform uses (add a temporary local-only log or inspect in a script, **never commit the URLs**) and adjust `isBlockEvent` if the wording differs.
4. Check whether she has already linked the platforms to each other. If so, Airbnb will export Booking.com stays as "Not available" blocks, so the same stay appears twice (one booking, one block). This is expected: **Phase 4 must not flag a block that overlaps a booking as a double booking**, and the Phase 11 export feed must **exclude `isBlock` bookings** so calendars never mirror each other in a loop.
