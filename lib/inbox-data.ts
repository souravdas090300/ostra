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
  })).reverse();
  const lastGuest = [...messages].reverse().find((m) => m.direction === "INBOUND") ?? null;
  const lastDetected = [...messages].reverse().find((m) => m.direction === "INBOUND" && m.language)?.language ?? null;
  const unresolved = messages.filter((m) => m.escalated && !m.resolved);
  return { booking, messages, lastGuestAt: lastGuest?.createdAt ?? null, lastDetected, unresolved };
}

/** For the navigation badge. */
export async function inboxCounts(ownerId: string) {
  const [needs, urgent, unknown] = await Promise.all([
    prisma.message.count({
      where: { escalated: true, resolved: false, booking: { apartment: { ownerId } } },
    }),
    prisma.message.count({
      where: { escalated: true, resolved: false, urgent: true, booking: { apartment: { ownerId } } },
    }),
    prisma.unmatchedMessage.count({
      where: { ownerId, handledAt: null, receivedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
    }),
  ]);
  return { needs, urgent, unknown };
}
