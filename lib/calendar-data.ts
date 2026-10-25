import { prisma } from "./db";
import { maltaLocalToUtc, maltaYmd } from "./time";
import { addDays } from "./dates";
import type { Stay } from "./conflicts";
import { linkState } from "./export-feeds";

const select = {
  id: true,
  apartmentId: true,
  source: true,
  isBlock: true,
  checkIn: true,
  checkOut: true,
  guestName: true,
  guestPhone: true,
  optedInAt: true,
  optedOutAt: true,
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
  optedInAt: Date | null;
  optedOutAt: Date | null;
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

export async function loadMessageIssues(ownerId: string) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const failedMessages = await prisma.scheduledMessage.findMany({
    where: {
      status: "FAILED",
      createdAt: { gte: sevenDaysAgo },
      booking: {
        apartment: { ownerId },
      },
    },
    include: {
      booking: {
        select: {
          apartmentId: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return failedMessages.map((m) => ({
    bookingId: m.bookingId,
    apartmentId: m.booking.apartmentId,
    type: m.type,
    reason: m.lastError || "Unknown error",
    createdAt: m.createdAt,
  }));
}

export async function loadDeliveryIssues(ownerId: string) {
  const deliveryIssues = await prisma.message.findMany({
    where: {
      deliveryStatus: { in: ["failed", "undelivered"] },
      booking: {
        apartment: { ownerId },
      },
    },
    include: {
      booking: {
        select: {
          apartmentId: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return deliveryIssues.map((m) => ({
    bookingId: m.bookingId,
    apartmentId: m.booking.apartmentId,
    deliveryStatus: m.deliveryStatus ?? "unknown",
    createdAt: m.createdAt,
  }));
}

export async function loadSkippedForNoTemplate(ownerId: string) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const skipped = await prisma.scheduledMessage.findMany({
    where: {
      status: "SKIPPED",
      skipReason: { contains: "No approved template" },
      createdAt: { gte: sevenDaysAgo },
      booking: {
        apartment: { ownerId },
      },
    },
    include: {
      booking: {
        select: {
          apartmentId: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Group by language to show once per language
  const byLanguage = new Map<string, { language: string; count: number; apartmentIds: Set<string> }>();
  for (const m of skipped) {
    const lang = m.language || "unknown";
    const existing = byLanguage.get(lang);
    if (existing) {
      existing.count++;
      existing.apartmentIds.add(m.booking.apartmentId);
    } else {
      byLanguage.set(lang, {
        language: lang,
        count: 1,
        apartmentIds: new Set([m.booking.apartmentId]),
      });
    }
  }

  return Array.from(byLanguage.entries()).map(([language, data]) => ({
    language,
    count: data.count,
    apartmentIds: Array.from(data.apartmentIds),
  }));
}

export async function loadEscalatedMessages(ownerId: string) {
  const escalated = await prisma.message.findMany({
    where: {
      escalated: true,
      resolved: false,
      booking: {
        apartment: { ownerId },
      },
    },
    include: {
      booking: {
        select: {
          apartmentId: true,
        },
      },
    },
    orderBy: [{ urgent: "desc" }, { createdAt: "desc" }],
  });

  return escalated.map((m) => ({
    bookingId: m.bookingId,
    apartmentId: m.booking.apartmentId,
    urgent: m.urgent,
    hostSummary: m.hostSummary || "Guest message needs attention",
    createdAt: m.createdAt,
  }));
}

export async function loadUnmatchedCount(ownerId: string) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const count = await prisma.unmatchedMessage.count({
    where: {
      ownerId,
      receivedAt: { gte: thirtyDaysAgo },
    },
  });
  return count;
}

export async function loadCalendarData(
  ownerId: string,
  from: string,
  days: number,
  today: string
) {
  const to = addDays(from, days);
  const now = new Date();
  const staleHours = Number(process.env.EXPORT_STALE_AFTER_HOURS ?? 48);
  const [apartments, viewStays, upcomingStays, feeds, exportFeeds, messageIssues, deliveryIssues, skippedForNoTemplate, escalatedMessages, unmatchedCount] =
    await Promise.all([
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
      prisma.exportFeed.findMany({
        where: { apartment: { ownerId } },
        include: { apartment: { select: { name: true } } },
      }),
      loadMessageIssues(ownerId),
      loadDeliveryIssues(ownerId),
      loadSkippedForNoTemplate(ownerId),
      loadEscalatedMessages(ownerId),
      loadUnmatchedCount(ownerId),
    ]);

  // Process export feeds to find stale/waiting ones
  const exportFeedIssues = exportFeeds
    .filter((feed) => {
      const state = linkState(feed, now, staleHours);
      return state === "STALE" || (state === "WAITING" && feed.enabledAt && now.getTime() - feed.enabledAt.getTime() > 24 * 60 * 60_000);
    })
    .map((feed) => ({
      apartmentId: feed.apartmentId,
      apartmentName: feed.apartment.name,
      target: feed.target,
      state: linkState(feed, now, staleHours),
      lastFetchedAt: feed.lastFetchedAt,
    }));

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
    exportFeedIssues,
    messageIssues,
    deliveryIssues,
    skippedForNoTemplate,
    escalatedMessages,
    unmatchedCount,
  };
}
