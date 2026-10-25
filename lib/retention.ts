import { prisma } from "./db";

const DAY = 86_400_000;

export async function runRetention(now = new Date(), dryRun = false) {
  const out = { bookings: 0, messages: 0, scheduled: 0, unmatched: 0, attempts: 0, leads: 0, leadMessages: 0 };

  const owners = await prisma.owner.findMany({ select: { id: true, retentionDays: true } });
  for (const o of owners) {
    const cutoff = new Date(now.getTime() - Math.min(730, Math.max(30, o.retentionDays)) * DAY);
    for (;;) {
      const batch = await prisma.booking.findMany({
        where: {
          apartment: { ownerId: o.id },
          isBlock: false,
          checkOut: { lt: cutoff },
          anonymisedAt: null,
        },
        select: { id: true },
        take: 500,
      });
      if (batch.length === 0) break;
      const ids = batch.map((b) => b.id);
      out.bookings += ids.length;
      if (dryRun) break; // count one batch only
      const [m, s] = await prisma.$transaction([
        prisma.message.deleteMany({ where: { bookingId: { in: ids } } }),
        prisma.scheduledMessage.deleteMany({ where: { bookingId: { in: ids } } }),
        prisma.booking.updateMany({
          where: { id: { in: ids } },
          data: { guestName: null, guestPhone: null, guestLanguage: null, notes: null, optedInAt: null, anonymisedAt: now },
        }),
      ]);
      out.messages += m.count;
      out.scheduled += s.count;
    }

    // Retention for leads: anonymize leads inactive for retention period
    for (;;) {
      const batch = await prisma.lead.findMany({
        where: {
          ownerId: o.id,
          lastInboundAt: { lt: cutoff },
          blockedAt: null,
          status: { not: "BOOKED" }, // keep converted leads
        },
        select: { id: true },
        take: 500,
      });
      if (batch.length === 0) break;
      const ids = batch.map((l) => l.id);
      out.leads += ids.length;
      if (dryRun) break;
      const lm = await prisma.leadMessage.deleteMany({ where: { leadId: { in: ids } } });
      await prisma.lead.updateMany({
        where: { id: { in: ids } },
        data: { name: null, phone: null, notes: null, checkIn: null, checkOut: null, guests: null, quotedCents: null, needsHostReason: null, hostSummary: null },
      });
      out.leadMessages += lm.count;
    }
  }
  if (!dryRun) {
    out.unmatched = (await prisma.unmatchedMessage.deleteMany({ where: { receivedAt: { lt: new Date(now.getTime() - 30 * DAY) } } })).count;
    out.attempts = (await prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 7 * DAY) } } })).count;
    await prisma.jobRun.deleteMany({ where: { startedAt: { lt: new Date(now.getTime() - 90 * DAY) } } });
    await prisma.auditLog.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 365 * DAY) } } });
    await prisma.auditLog.create({ data: { action: "RETENTION_RUN", targetType: "system", targetId: null } });
  }
  return out;
}
