# Ostra Phase 11: Calendar export (stop double bookings across channels)

> **For Devin:** read `OSTRA_PLAN_ADDENDUM_ENQUIRIES.md` (Phase 11), `OSTRA_PHASE3_ICAL_SYNC.md`, `OSTRA_PHASE5_BOOKINGS.md`, `OSTRA_PHASE9_HARDENING.md` and this file. This file **replaces** Phase 11 in the addendum where they differ. (In the later numbering used elsewhere, this is "E4".) Complete **Phase 11 only**, in one PR, and meet every acceptance criterion in section 12. Assumes Phases 1-10 are merged.

## 0. What this phase does and why

Ostra already **imports** bookings from Airbnb and Booking.com. A direct booking made in Ostra, or a booking that arrives on one platform, does not yet block the other platforms. This phase adds an **export**: for each apartment, secret calendar links that Airbnb and Booking.com can import, so the dates reserved elsewhere are blocked there.

## 0.1 Decisions that shape the code

1. **One feed per target platform, never including that platform's own bookings.** The Airbnb link contains Booking.com and direct bookings; the Booking.com link contains Airbnb and direct bookings. Importing a platform's own reservations back into itself creates confusing duplicate blocks.
2. **Blocks are never exported.** Phase 3 imports blocks (such as Airbnb's "Not available") as `isBlock`. Exporting them would let one platform's mirrored blocks flow to the other and around again. The feed contains only confirmed, real bookings.
3. **Privacy by construction.** Each event is all-day, titled `Reserved`, with a stable id and **no guest name, phone, notes, apartment name or source**. Anyone with the link learns only which nights are taken.
4. **Secret, revocable links.** Each link contains 192 bits of randomness, can be regenerated (which kills the old link), and is never logged, shown in error reports or emailed.
5. **Each target starts disabled.** The operator enables a target only after the **loop test** (section 8) passes for that platform. Platforms behave differently and change over time, and one that re-exports imported calendars as reservation-like events could create a feedback loop. If a platform fails the test, it stays on manual blocking.
6. **Nothing is instant.** Platforms re-read imported calendars every few hours, so a short window of risk remains. The product says so, keeps a manual-blocking reminder for stays starting soon, and shows when each platform last read the link.
7. **Honest limits:** platform blocks the host sets by hand are **not** copied to the other platform (section 11 says how that could be done later).

## 1. Schema (migration `phase11_calendar_export`)

```prisma
enum ExportTarget { AIRBNB BOOKING_COM }

model Apartment {
  // remove: icalExportToken (never used; replaced by ExportFeed)
  exportFeeds ExportFeed[]
}

model ExportFeed {
  id            String       @id @default(cuid())
  apartmentId   String
  apartment     Apartment    @relation(fields: [apartmentId], references: [id], onDelete: Cascade)
  target        ExportTarget
  token         String       @unique          // 32 characters from 24 random bytes, base64url
  enabled       Boolean      @default(false)
  enabledAt     DateTime?
  confirmedAt   DateTime?                     // host says she added the link on the platform
  lastFetchedAt DateTime?
  fetchCount    Int          @default(0)
  createdAt     DateTime     @default(now())
  @@unique([apartmentId, target])
}
```
Tokens are generated in application code only: `randomBytes(24).toString("base64url")`. Do not use `cuid()` or database functions for them.

Environment: `EXPORT_STALE_AFTER_HOURS=48`.

## 2. Building the feed: `src/lib/ical-export.ts`

```ts
import { createHash } from "node:crypto";
import { addDays } from "./dates";
import type { ExportTarget } from "@prisma/client";

export type ExportStay = {
  id: string; source: "AIRBNB" | "BOOKING_COM" | "DIRECT"; isBlock: boolean;
  inYmd: string; outYmd: string; createdAt: Date;
};

const OWN: Record<ExportTarget, "AIRBNB" | "BOOKING_COM"> = { AIRBNB: "AIRBNB", BOOKING_COM: "BOOKING_COM" };
const HORIZON_DAYS = 730;

/** Real, future-relevant stays that the target platform does not already know about. Blocks are never exported. */
export function selectStays(target: ExportTarget, stays: ExportStay[], todayYmd: string): ExportStay[] {
  const earliest = addDays(todayYmd, -1);
  const latest = addDays(todayYmd, HORIZON_DAYS);
  return stays.filter(
    (s) => !s.isBlock && s.source !== OWN[target] && s.outYmd > s.inYmd && s.outYmd >= earliest && s.inYmd <= latest,
  );
}

const compact = (ymd: string) => ymd.replaceAll("-", "");
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const fold = (line: string) => (line.match(/.{1,74}/g) ?? [""]).map((p, i) => (i ? " " + p : p)).join("\r\n");

/** RFC 5545 calendar, CRLF line endings, ASCII only, all-day events, no personal data. */
export function buildIcs(stays: ExportStay[]): string {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Ostra//Availability Export//EN",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Ostra availability",
  ];
  const sorted = [...stays].sort((a, b) => a.inYmd.localeCompare(b.inYmd) || a.id.localeCompare(b.id));
  for (const s of sorted) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${s.id}@ostra`,
      `DTSTAMP:${stamp(s.createdAt)}`,            // stable, so the body (and ETag) only changes when bookings change
      `DTSTART;VALUE=DATE:${compact(s.inYmd)}`,
      `DTEND;VALUE=DATE:${compact(s.outYmd)}`,    // the check-out date is exclusive: same-day turnovers stay bookable
      "SUMMARY:Reserved",
      "STATUS:CONFIRMED",
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export const etagOf = (body: string) => `"${createHash("sha1").update(body).digest("hex")}"`;
```

**Data access** (`src/lib/export-data.ts`): `loadApartmentStays(apartmentId, fromYmd, toYmd)` selects only `id, source, isBlock, checkIn, checkOut, createdAt` for **that apartment**, `status: "CONFIRMED"`, `isBlock: false`, overlapping the range (same instant logic as `loadStays` in Phase 4), and maps to `ExportStay` using `maltaYmd`. It takes an apartment id (from the token), not an owner id.

## 3. The public feed route: `src/app/api/ical/[token]/route.ts`

```ts
import { prisma } from "@/lib/db";
import { addDays, todayMalta } from "@/lib/dates";
import { buildIcs, etagOf, selectStays } from "@/lib/ical-export";
import { loadApartmentStays } from "@/lib/export-data";
import { clientIp } from "@/lib/login-guard";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });

async function handle(req: Request, params: Promise<{ token: string }>, head: boolean) {
  const raw = (await params).token;
  const token = raw.endsWith(".ics") ? raw.slice(0, -4) : raw;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return NOT_FOUND();
  if (!rateLimit(`ical:${clientIp(req.headers)}`, 60, 60_000)) return new Response("Too many requests", { status: 429 });

  const feed = await prisma.exportFeed.findUnique({ where: { token } });
  if (!feed || !feed.enabled) return NOT_FOUND(); // unknown, disabled and revoked links look the same

  // Record that a platform read the link, at most once a minute.
  const now = new Date();
  if (!feed.lastFetchedAt || now.getTime() - feed.lastFetchedAt.getTime() > 60_000) {
    await prisma.exportFeed.update({ where: { id: feed.id }, data: { lastFetchedAt: now, fetchCount: { increment: 1 } } });
  }

  const today = todayMalta(now);
  const stays = await loadApartmentStays(feed.apartmentId, addDays(today, -1), addDays(today, 730));
  const body = buildIcs(selectStays(feed.target, stays, today));
  const etag = etagOf(body);
  const headers = {
    etag, "cache-control": "private, max-age=300", "x-robots-tag": "noindex",
    "content-type": "text/calendar; charset=utf-8", "content-disposition": 'inline; filename="ostra.ics"',
  };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag } });
  return new Response(head ? null : body, { status: 200, headers });
}

export const GET = (req: Request, ctx: { params: Promise<{ token: string }> }) => handle(req, ctx.params, false);
export const HEAD = (req: Request, ctx: { params: Promise<{ token: string }> }) => handle(req, ctx.params, true);
```
- Phase 1 middleware must exclude `/api/ical/*` from the session check (it authenticates by the token).
- **Never log the path of this route** or the token. Phase 9's Sentry `beforeSend` must also replace the path of any `event.request.url` that starts with `/api/ical/` by `/api/ical/[redacted]`, and `scrub` must be applied to Next.js request log lines if any exist. Add a test for it.
- Platforms may read the link without any `Accept` header and with unusual user agents; do not require either.

## 4. Link management

**`src/lib/export-feeds.ts`**
```ts
import { randomBytes } from "node:crypto";
import { prisma } from "./db";
import type { ExportTarget } from "@prisma/client";

export const newExportToken = () => randomBytes(24).toString("base64url");
export const TARGETS: ExportTarget[] = ["AIRBNB", "BOOKING_COM"];

/** Idempotent. New links start disabled. */
export async function ensureExportFeeds(apartmentId: string) {
  for (const target of TARGETS) {
    await prisma.exportFeed.upsert({
      where: { apartmentId_target: { apartmentId, target } },
      update: {},
      create: { apartmentId, target, token: newExportToken() },
    });
  }
}

export type LinkState = "DISABLED" | "WAITING" | "CONNECTED" | "STALE";

export function linkState(
  f: { enabled: boolean; lastFetchedAt: Date | null }, now = new Date(),
  staleHours = Number(process.env.EXPORT_STALE_AFTER_HOURS ?? 48),
): LinkState {
  if (!f.enabled) return "DISABLED";
  if (!f.lastFetchedAt) return "WAITING";               // enabled, no platform has read it yet
  return now.getTime() - f.lastFetchedAt.getTime() > staleHours * 3_600_000 ? "STALE" : "CONNECTED";
}
```

**Actions** (`src/app/(app)/apartments/export-actions.ts`, all owner-scoped by joining `apartment: { ownerId }`, all return `{ ok?: true; error?: string }`, all revalidate the apartment page):
- `enableExport(apartmentId, target)` sets `enabled = true`, `enabledAt = now`. Refuse (with a clear message) if the apartment has no confirmed way to block manually yet? No: allow, but the UI shows the loop-test acknowledgement checkbox first (section 5).
- `disableExport(apartmentId, target)` sets `enabled = false` (the link then returns 404, so the platform's next read fails; tell the host to remove the link on the platform too).
- `confirmExport(apartmentId, target, confirmed)` sets or clears `confirmedAt` ("I added this link in Airbnb").
- `regenerateExportToken(apartmentId, target)` replaces `token`, resets `lastFetchedAt`, `fetchCount`, `confirmedAt` and `enabledAt`; the old link stops working immediately. The UI warns that the platform must be updated.
- `ensureExportFeeds` runs when the apartment page loads.

## 5. UI

**Apartment page, section "Calendar export (stop double bookings)"** (`ExportPanel`, client component for the copy buttons):
- Intro: "Airbnb and Booking.com read these links every few hours, not instantly. They only learn which nights are taken, never who the guest is."
- One card per platform with: status badge from `linkState` (**Off**, **Waiting for Airbnb to read it**, **Connected, last read 2 hours ago**, **Not read for 3 days, check it**), the link (hidden behind **Show link**, with **Copy**), the buttons **Turn on** / **Turn off**, **I added it in Airbnb** (checkbox → `confirmExport`), and **Make a new link** (confirm: "The old link stops working. You must paste the new one into Airbnb.").
- **Turn on** first shows a short acknowledgement dialog: "Only turn this on after the loop test in docs/EXPORT_TEST.md passed for this platform", with a checkbox the user must tick (this is a deliberate speed bump; it is not a security control).
- Steps for the host, in plain words: "Open your Airbnb calendar settings, find the option to import a calendar, paste the link, and name it Ostra." For Booking.com: "In your Booking.com extranet open the calendar sync settings and import a calendar from the link." Add the sentence "Menu names change. If you cannot find it, look in the platform's help for importing an iCal calendar." and, for Booking.com, "Not every Booking.com account offers calendar import. If yours does not, keep blocking dates by hand."
- Add the **manual block reminder** below: "Platform refresh is slow. For a stay that starts within 3 days, also block the dates by hand."

**`PlatformBlockNotice` (Phase 5)** gets the real state instead of the constant `ICAL_EXPORT_ENABLED` (delete `lib/features.ts` and its usage):
```ts
type Props = {
  apartmentName: string; inYmd: string; outYmd: string;
  source: "DIRECT" | "AIRBNB" | "BOOKING_COM";
  states: Record<"AIRBNB" | "BOOKING_COM", LinkState>;
  lastFetched: Record<"AIRBNB" | "BOOKING_COM", Date | null>;
  now: Date;
};
```
Rules, per platform the booking is **not** from (direct bookings: both platforms; an Airbnb booking: Booking.com only; a Booking.com booking: Airbnb only):
- Link state `CONNECTED`: a soft note "Ostra's calendar link will block these dates on {platform} within a few hours (it last read the link {time ago}). If the stay starts within 3 days, also block it by hand." (the second sentence only when `inYmd` is within 3 days of today).
- State `DISABLED`, `WAITING` or `STALE`: the Phase 5 amber warning "Block these dates on {platform}", with the dates and the reason (for `STALE`: "the calendar link has not been read for N days").
- Show it only for confirmed bookings that have not ended and are not blocks.
- Show it on the booking detail page for **all** such bookings, not only direct ones, so a booking arriving on Airbnb also reminds her about Booking.com until the link is connected.

**Phase 4 attention panel** adds: export links that are enabled but `STALE` ("{platform} has not read the calendar link for {apartment} for {N} days") and links that are `WAITING` for over 24 hours after being enabled, each linking to the apartment page. **`/settings/status`** lists every link's state, last read, and read count per apartment (no tokens).

## 6. Operator alerts (Phase 9 `self-check`)
Add to the self-check job:
- An enabled link `STALE` (not read for the stale threshold) or `WAITING` for over 48 hours.
- **Possible mirror loop:** for each enabled target, count confirmed bookings whose source is that target's platform, that were created **after** `enabledAt`, and whose dates are **identical** to a confirmed booking from another source in the same apartment (the pattern a platform that re-exports imports would produce). One or more triggers an operator email "Possible mirror from {platform} for apartment {id}; check docs/EXPORT_TEST.md; consider turning the link off". This is only an alert: it never hides or changes a booking, because the same pattern can also be a genuine double booking.

## 7. Documents
- `docs/EXPORT_TEST.md`: the loop test below and a log table (date, apartment, platform, result, refresh time observed).
- Update `docs/RUNBOOK.md`: enabling, disabling, regenerating links; what to do on a suspected loop (turn the link off, ask the host to remove the import on the platform, cancel any mirror bookings it created by removing the Booking.com link's imported events through the next sync, and check the calendar by hand); how to find a leaked link (regenerate it).
- Update `/privacy` and `docs/DATA_PROTECTION.md`: the calendar link shares only reserved dates with Airbnb and Booking.com (which are also the host's own booking channels), contains no personal data, and can be revoked at any time.
- Update `docs/SECURITY.md`: export tokens are secrets, 192 bits, revocable, not logged.

## 8. The loop test (mandatory before enabling each platform; run per platform, in staging or on a quiet future date)
1. Pick one apartment and a date range far in the future that is free on all platforms. Create a **direct booking** for it in Ostra (guest name "TEST", no phone).
2. Enable only the **Airbnb** link and add it to Airbnb as an imported calendar. Wait until Airbnb shows the dates blocked (this can take hours; record how long).
3. After Airbnb has blocked them, wait for Ostra's next Airbnb sync and check: the dates arrive as a **block** (Airbnb's "Not available" wording), no new booking appears, no double-booking alert appears, and **the Airbnb link's own content did not grow** (open the link and count events before and after).
4. Cancel the test booking in Ostra. Confirm the Airbnb link drops it, Airbnb removes the block (record how long), and the next sync cancels the block in Ostra.
5. Repeat steps 1 to 4 for **Booking.com**, with one more check at step 3: after Booking.com has imported the link, the Booking.com calendar feed that Ostra reads must **not** contain events for those test dates that did not exist before. If events for the test dates appear in Booking.com's own export, that platform re-exports imported calendars: **do not enable the Booking.com link**; keep blocking by hand or use a channel manager.
6. Record the result and timings in `docs/EXPORT_TEST.md`. Only then enable the link for the real calendars, one apartment first, then the rest after a week without surprises.

## 9. Tests

**Unit tests (no database)**
- `selectStays`: Airbnb target excludes Airbnb bookings and includes Booking.com and direct; Booking.com target excludes Booking.com and includes Airbnb and direct; blocks never included (including blocks that overlap bookings); cancelled stays never reach the function (assert the loader filter separately); stays that ended before yesterday excluded; stays starting beyond 730 days excluded; zero-length excluded.
- `buildIcs`: valid structure (`BEGIN:VCALENDAR` first, `END:VCALENDAR` last, every `BEGIN:VEVENT` has an end); CRLF line endings only; no line longer than 75 octets; ASCII only; `DTSTART` and `DTEND` all-day, check-out date exclusive (a stay 5 to 8 November gives `20261105` and `20261108`); a same-day turnover gives the same `DTEND` and next `DTSTART` date; `UID` is the booking id plus `@ostra` and stable across calls; `DTSTAMP` equals the booking's `createdAt` and is stable; `SUMMARY:Reserved`; output sorted deterministically; empty list gives a valid empty calendar; **no guest name, phone, notes, apartment name, source or token string appears in the output** (test with sentinel strings in every field).
- **Round trip:** `parseFeed` (Phase 3) applied to `buildIcs` output returns the same start and end dates, for dates across the October and March clock changes and the new year; every imported event gets `isBlockEvent("AIRBNB", "Reserved")` false.
- `etagOf`: same body same etag; one changed date changes it.
- `newExportToken`: length 32, `base64url` alphabet, 1000 tokens are unique.
- `linkState`: all four states, the exact stale boundary.
- `PlatformBlockNotice` state logic: direct booking with both connected shows two soft notes; with Airbnb `STALE` shows the amber warning for Airbnb and the soft note for Booking.com; an Airbnb booking never produces an Airbnb notice; the "within 3 days" sentence appears only for near stays; ended, cancelled and block bookings produce nothing.
- Sentry scrub: a request URL `/api/ical/<token>.ics` becomes `/api/ical/[redacted]`; `scrub` removes the token when it appears inside a full URL.

**Database and route tests**
1. Feed route: unknown token, malformed token, disabled link and a regenerated (old) token all return the same 404 with `no-store`; an enabled link returns 200, `text/calendar; charset=utf-8`, `etag`, `cache-control: private, max-age=300`, `x-robots-tag: noindex`; `If-None-Match` returns 304; `HEAD` returns headers and no body; no session is needed; a `.ics` suffix and no suffix both work.
2. **Isolation:** the token of apartment A never returns bookings of apartment B or of another owner (create two owners with overlapping dates); the Airbnb token and the Booking.com token of the same apartment return different content as specified.
3. `lastFetchedAt` and `fetchCount` update at most once per minute, also on 304 responses; rate limit returns 429 after 60 requests per minute from one address.
4. Actions: `enableExport`, `disableExport`, `confirmExport`, `regenerateExportToken` are owner-scoped (another owner's apartment gives `notFound`); regenerate invalidates the old token at once and clears fetch and confirmation state; `ensureExportFeeds` is idempotent and creates disabled feeds; deleting an apartment deletes its feeds.
5. **No feedback loop (simulated platform behaviour):** build a fixture where Airbnb "imports" the Airbnb export and returns its own calendar plus the imported dates as `Airbnb (Not available)` blocks; run export, Airbnb sync, export three times; assert the export content is **identical** each time, the blocks arrive as `isBlock`, no booking is created, and no double-booking conflict is reported. Add a second fixture where Booking.com does **not** re-export (expected) and assert the same.
6. A booking cancelled by the Airbnb sync disappears from the Booking.com link on the next read; a direct booking cancelled in Ostra disappears from both; a date change moves it.
7. Self-check: stale and waiting links raise the alert once; the possible-mirror pattern (a Booking.com booking created after `enabledAt` with dates identical to a direct booking) raises the alert once and does **not** change any booking; ordinary bookings with identical dates created **before** `enabledAt` do not.
8. Privacy: the route never logs the token or the path (spy on `log` and `console`); the Sentry hook redacts the path.
9. Phase 5 and Phase 4 integration: the booking detail page shows the correct notice for each combination of source and link state; the attention panel lists stale links; `lib/features.ts` no longer exists and nothing imports it.

## 10. Manual checks
1. Enable the Airbnb link for one test apartment and open the URL in a browser: a plain calendar of `Reserved` events, no names.
2. Run the full loop test (section 8) for Airbnb and record timings; then for Booking.com, noting whether your account offers calendar import at all.
3. Create a direct booking, watch the notice change as the platform reads the link, and confirm the platform shows the block.
4. Regenerate a link and confirm the old one returns 404 at once and the status shows "Waiting".
5. Check the status page and the attention panel after switching a link off for two days in staging (or by editing `lastFetchedAt`).

## 11. Not in this phase
- Copying **manual blocks** from one platform to the other. This needs Ostra-native blocks (a "Block dates" action in Ostra that is exported to both platforms) and a way to recognise real platform blocks versus mirrors; build it only if she asks, after a successful loop test and several weeks of clean operation.
- Writing directly to platform APIs or a channel manager integration, instant propagation, and price or minimum-stay sync.
- Per-guest or per-owner export of guest names (the feed never contains personal data).

## 12. Acceptance criteria
- Each apartment has two secret, revocable links (Airbnb and Booking.com), disabled by default, enabled per platform by an explicit action after the loop test.
- The Airbnb link never contains Airbnb bookings, the Booking.com link never contains Booking.com bookings, and neither contains blocks, cancelled bookings, or any personal data, apartment name or source.
- The feed is valid RFC 5545 all-day data with the check-out date exclusive, stable ids and ETag support, and parses back through the Phase 3 importer to the same dates.
- Unknown, disabled and revoked links are indistinguishable 404s; the token is never logged or sent to error reports; fetches are rate limited and tracked.
- The simulated export, import, export cycle is stable (no loop), and the self-check alerts on stale links and on the possible-mirror pattern without altering bookings.
- Booking pages and the dashboard show the right per-platform reminders based on real link state, and `ICAL_EXPORT_ENABLED` is gone.
- `docs/EXPORT_TEST.md`, the runbook, security and privacy documents are updated, and the loop test has been run and logged for at least Airbnb.
- Everything is owner-scoped where a session is involved; `npm run lint`, `typecheck`, `test`, `build` pass; the migration applies on a fresh database.
