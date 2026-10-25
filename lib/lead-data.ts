import { prisma } from "./db";
import { maltaYmd } from "./time";

export type LeadRow = {
  id: string;
  phone: string;
  name: string | null;
  status: string;
  checkIn: string | null;
  checkOut: string | null;
  guests: number | null;
  apartmentName: string | null;
  quotedCents: number | null;
  lastBody: string;
  lastDirection: "INBOUND" | "OUTBOUND";
  lastAt: Date;
  unresolved: number;
  urgent: boolean;
};

/** One row per lead. Needs-attention first (urgent first), then newest. Owner-scoped. */
export async function loadLeads(ownerId: string, limit = 100): Promise<LeadRow[]> {
  const rows = await prisma.$queryRaw<
    {
      id: string;
      phone: string;
      name: string | null;
      status: string;
      checkIn: Date | null;
      checkOut: Date | null;
      guests: number | null;
      apartmentName: string | null;
      quotedCents: number | null;
      lastBody: string;
      lastDirection: "INBOUND" | "OUTBOUND";
      lastAt: Date;
      unresolved: number;
      urgent: boolean;
    }[]
  >`
    SELECT l."id", l."phone", l."name", l."status", l."checkIn", l."checkOut", l."guests",
           a."name" AS "apartmentName", l."quotedCents",
           m."body" AS "lastBody", m."direction" AS "lastDirection", m."createdAt" AS "lastAt",
           COALESCE(u."unresolved", 0)::int AS "unresolved", COALESCE(u."urgent", false) AS "urgent"
    FROM "Lead" l
    LEFT JOIN "Apartment" a ON a."id" = l."apartmentId"
    JOIN LATERAL (
      SELECT "body", "direction", "createdAt" FROM "LeadMessage"
      WHERE "leadId" = l."id" ORDER BY "createdAt" DESC, "id" DESC LIMIT 1
    ) m ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS "unresolved", BOOL_OR("urgent") AS "urgent" FROM "LeadMessage"
      WHERE "leadId" = l."id" AND "escalated" AND NOT "resolved"
    ) u ON true
    WHERE l."ownerId" = ${ownerId} AND l."blockedAt" IS NULL
    ORDER BY (COALESCE(u."unresolved", 0) > 0) DESC, COALESCE(u."urgent", false) DESC, m."createdAt" DESC
    LIMIT ${limit}`;
  return rows.map((r) => ({
    id: r.id,
    phone: r.phone,
    name: r.name,
    status: r.status,
    checkIn: r.checkIn ? maltaYmd(r.checkIn) : null,
    checkOut: r.checkOut ? maltaYmd(r.checkOut) : null,
    guests: r.guests,
    apartmentName: r.apartmentName,
    quotedCents: r.quotedCents,
    lastBody: r.lastBody.slice(0, 140),
    lastDirection: r.lastDirection,
    lastAt: r.lastAt,
    unresolved: r.unresolved,
    urgent: r.urgent,
  }));
}

export async function loadLeadThread(ownerId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, ownerId },
    include: { apartment: true },
  });
  if (!lead) return null;
  const messages = (await prisma.leadMessage.findMany({
    where: { leadId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
  })).reverse().map((m) => ({
    ...m,
    author: m.author ?? undefined,
    deliveryStatus: m.deliveryStatus ?? undefined,
    originalBody: m.originalBody ?? undefined,
  }));
  const lastGuest = [...messages].reverse().find((m) => m.direction === "INBOUND") ?? null;
  const lastDetected = [...messages].reverse().find((m) => m.direction === "INBOUND" && m.language)?.language ?? null;
  const unresolved = messages.filter((m) => m.escalated && !m.resolved).map((m) => ({
    ...m,
    hostSummary: m.hostSummary ?? undefined,
    escalationReason: m.escalationReason ?? undefined,
  }));
  return { lead, messages, lastGuestAt: lastGuest?.createdAt ?? null, lastDetected, unresolved };
}
