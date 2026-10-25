import { prisma } from "./db";
import { inAllowedWindow } from "./send-time";
import { notifyHost } from "./notify";

const URGENT_AFTER_MS = 15 * 60_000;
const NORMAL_AFTER_MS = 4 * 3_600_000;

/** One email per booking per run. Marks each message so it is reminded once only. */
export async function sendEscalationReminders(now = new Date()): Promise<{ bookings: number; messages: number }> {
  const waking = inAllowedWindow(now);
  const rows = await prisma.message.findMany({
    where: {
      direction: "INBOUND",
      escalated: true,
      resolved: false,
      reminderSentAt: null,
      OR: [
        { urgent: true, createdAt: { lt: new Date(now.getTime() - URGENT_AFTER_MS) } },
        ...(waking ? [{ urgent: false, createdAt: { lt: new Date(now.getTime() - NORMAL_AFTER_MS) } }] : []),
      ],
    },
    include: { booking: { include: { apartment: { include: { owner: true } } } } },
  });
  const byBooking = new Map<string, typeof rows>();
  for (const r of rows) (byBooking.get(r.bookingId) ?? byBooking.set(r.bookingId, []).get(r.bookingId)!).push(r);

  for (const [bookingId, list] of byBooking) {
    const { apartment } = list[0].booking;
    const urgent = list.some((m) => m.urgent);
    await notifyHost({
      to: apartment.owner.email,
      subject: `${urgent ? "URGENT reminder: " : "Reminder: "}a guest is still waiting at ${apartment.name}`,
      text: `${list.length} message(s) have not been answered.\n\nOpen: ${process.env.APP_URL}/inbox/${bookingId}`,
    });
    await prisma.message.updateMany({ where: { id: { in: list.map((m) => m.id) } }, data: { reminderSentAt: now } });
  }
  return { bookings: byBooking.size, messages: rows.length };
}

/** One email per lead per run. Marks each message so it is reminded once only. */
export async function sendLeadReminders(now = new Date()): Promise<{ leads: number; messages: number }> {
  const waking = inAllowedWindow(now);
  const rows = await prisma.leadMessage.findMany({
    where: {
      direction: "INBOUND",
      escalated: true,
      resolved: false,
      reminderSentAt: null,
      OR: [
        { urgent: true, createdAt: { lt: new Date(now.getTime() - URGENT_AFTER_MS) } },
        ...(waking ? [{ urgent: false, createdAt: { lt: new Date(now.getTime() - NORMAL_AFTER_MS) } }] : []),
      ],
    },
    include: { lead: { include: { owner: true } } },
  });
  const byLead = new Map<string, typeof rows>();
  for (const r of rows) (byLead.get(r.leadId) ?? byLead.set(r.leadId, []).get(r.leadId)!).push(r);

  for (const [leadId, list] of byLead) {
    const { owner } = list[0].lead;
    const urgent = list.some((m) => m.urgent);
    await notifyHost({
      to: owner.email,
      subject: `${urgent ? "URGENT reminder: " : "Reminder: "}an enquiry is still waiting`,
      text: `${list.length} message(s) from a potential guest have not been answered.\n\nOpen: ${process.env.APP_URL}/leads/${leadId}`,
    });
    await prisma.leadMessage.updateMany({ where: { id: { in: list.map((m) => m.id) } }, data: { reminderSentAt: now } });
  }
  return { leads: byLead.size, messages: rows.length };
}
