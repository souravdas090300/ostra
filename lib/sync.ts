import { prisma } from "./db";
import { fetchFeedText, FeedError } from "./ical-fetch";
import { parseFeed, isBlockEvent } from "./ical";
import { maltaLocalToUtc, maltaYmd } from "./time";
import { rescheduleBookings } from "./schedule";
import { log } from "./log";

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
      // Only use advisory lock on PostgreSQL; skip for SQLite in local dev.
      const isPostgres = process.env.DATABASE_URL?.includes("postgres") || process.env.DATABASE_URL?.includes("postgresql");

      if (isPostgres) {
        const [{ locked }] = await tx.$queryRaw<Array<{ locked: boolean }>>`
          SELECT pg_try_advisory_xact_lock(hashtext(${feed.id})) AS locked
        `;
        if (!locked) return { skipped: true, created: 0, updated: 0, cancelled: 0 };
      }

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
        const isBlock = isBlockEvent(feed.source as "AIRBNB" | "BOOKING_COM", ev.summary);
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
        if (cur) {
          updated++;
        } else {
          created++;
        }
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
    if (!(e instanceof FeedError)) log("error", "sync failed", { feedId });
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
