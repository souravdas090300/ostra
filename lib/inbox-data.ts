import { prisma } from "./db";
import { maltaYmd } from "./time";

export type InboxRow = {
  bookingId: string;
  apartmentName: string;
  guestName: string | null;
  inYmd: string;
  outYmd: string;
  lastBody: string;
  lastDirection: "INBOUND" | "OUTBOUND";
  lastAt: Date;
  unresolved: number;
  urgent: boolean;
};

/** One row per booking that has messages. Needs-attention first (urgent first), then newest. Owner-scoped. */
export async function loadInbox(ownerId: string, limit = 100): Promise<InboxRow[]> {
  const rows = await prisma.$queryRaw<
    {
      bookingId: string;
      apartmentName: string;
      guestName: string | null;
      checkIn: Date;
      checkOut: Date;
      lastBody: string;
      lastDirection: "INBOUND" | "OUTBOUND";
      lastAt: Date;
      unresolved: number;
      urgent: boolean;
    }[]
  >`
    SELECT b."id" AS "bookingId", a."name" AS "apartmentName", b."guestName", b."checkIn", b."checkOut",
           m."body" AS "lastBody", m."direction" AS "lastDirection", m."createdAt" AS "lastAt",
           COALESCE(u."unresolved", 0)::int AS "unresolved", COALESCE(u."urgent", false) AS "urgent"
    FROM "Booking" b
    JOIN "Apartment" a ON a."id" = b."apartmentId"
    JOIN LATERAL (
      SELECT "body", "direction", "createdAt" FROM "Message"
      WHERE "bookingId" = b."id" ORDER BY "createdAt" DESC, "id" DESC LIMIT 1
    ) m ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS "unresolved", BOOL_OR("urgent") AS "urgent" FROM "Message"
      WHERE "bookingId" = b."id" AND "escalated" AND NOT "resolved"
    ) u ON true
    WHERE a."ownerId" = ${ownerId}
    ORDER BY (COALESCE(u."unresolved", 0) > 0) DESC, COALESCE(u."urgent", false) DESC, m."createdAt" DESC
    LIMIT ${limit}`;
  return rows.map((r) => ({
    bookingId: r.bookingId,
    apartmentName: r.apartmentName,
    guestName: r.guestName,
    inYmd: maltaYmd(r.checkIn),
    outYmd: maltaYmd(r.checkOut),
    lastBody: r.lastBody.slice(0, 140),
    lastDirection: r.lastDirection,
    lastAt: r.lastAt,
    unresolved: r.unresolved,
    urgent: r.urgent,
  }));
}

export async function loadThread(ownerId: string, bookingId: string) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, isBlock: false, apartment: { ownerId } },
    include: { apartment: true },
  });
  if (!booking) return null;
  const messages = (await prisma.message.findMany({
    where: { bookingId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
  })).reverse().map((m) => ({
    ...m,
    author: m.author ?? undefined,
    deliveryStatus: m.deliveryStatus ?? undefined,
    originalBody: m.originalBody ?? undefined,
    feedback: m.feedback as "GOOD" | "WRONG" | null | undefined,
    feedbackNote: m.feedbackNote ?? undefined,
  }));
  const lastGuest = [...messages].reverse().find((m) => m.direction === "INBOUND") ?? null;
  const lastDetected = [...messages].reverse().find((m) => m.direction === "INBOUND" && m.language)?.language ?? null;
  const unresolved = messages.filter((m) => m.escalated && !m.resolved).map((m) => ({
    ...m,
    hostSummary: m.hostSummary ?? undefined,
    escalationReason: m.escalationReason ?? undefined,
  }));
  return { booking, messages, lastGuestAt: lastGuest?.createdAt ?? null, lastDetected, unresolved };
}

/** For the navigation badge. */
export async function inboxCounts(ownerId: string): Promise<{ needs: number; urgent: number; unknown: number; leadsNeeds: number }> {
  const [needs, urgent, unknown, leadsNeeds] = await Promise.all([
    prisma.message.count({
      where: { escalated: true, resolved: false, booking: { apartment: { ownerId } } },
    }),
    prisma.message.count({
      where: { escalated: true, resolved: false, urgent: true, booking: { apartment: { ownerId } } },
    }),
    prisma.unmatchedMessage.count({
      where: { ownerId, handledAt: null, receivedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
    }),
    prisma.leadMessage.count({
      where: { escalated: true, resolved: false, lead: { ownerId } },
    }),
  ]);
  return { needs, urgent, unknown, leadsNeeds };
}

export type WrongAnswer = {
  id: string;
  bookingId: string;
  apartmentName: string;
  question: string;
  body: string;
  feedbackNote: string | null;
  feedbackAt: Date | null;
};

export async function loadWrongAnswers(ownerId: string, since: Date): Promise<WrongAnswer[]> {
  const messages = await prisma.message.findMany({
    where: {
      booking: { apartment: { ownerId } },
      author: "AI",
      direction: "OUTBOUND",
      feedback: "WRONG",
      feedbackAt: { gte: since },
    },
    include: {
      booking: {
        select: {
          id: true,
          apartment: { select: { name: true } },
        },
      },
    },
    orderBy: { feedbackAt: "desc" },
    take: 20,
  });

  // For each wrong answer, try to find the previous inbound message
  const results: WrongAnswer[] = [];
  for (const msg of messages) {
    const previousInbound = await prisma.message.findFirst({
      where: {
        bookingId: msg.bookingId,
        direction: "INBOUND",
        createdAt: { lt: msg.createdAt },
      },
      orderBy: { createdAt: "desc" },
      select: { body: true },
    });

    results.push({
      id: msg.id,
      bookingId: msg.booking.id,
      apartmentName: msg.booking.apartment.name,
      question: previousInbound?.body || "Guest question (see conversation)",
      body: msg.body,
      feedbackNote: msg.feedbackNote,
      feedbackAt: msg.feedbackAt,
    });
  }

  return results;
}
