import { prisma } from "./db";
import { rescheduleBookings } from "./schedule";
import { hashPhone } from "./hash";

/** Called by Phase 7 when a guest replies STOP (or the AI detects an opt-out request). */
export async function optOutPhone(ownerId: string, e164: string): Promise<void> {
  const rows = await prisma.booking.findMany({
    where: { guestPhone: e164, apartment: { ownerId } },
    select: { id: true },
  });
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return;
  await prisma.booking.updateMany({ where: { id: { in: ids } }, data: { optedOutAt: new Date() } });
  await rescheduleBookings(ids);

  // Also store as keyed hash for opt-out survival after data deletion
  const phoneHash = hashPhone(e164);
  await prisma.optOut.upsert({
    where: { ownerId_phoneHash: { ownerId, phoneHash } },
    create: { ownerId, phoneHash },
    update: {},
  });
}

export async function phoneIsOptedOut(ownerId: string, e164: string): Promise<boolean> {
  const phoneHash = hashPhone(e164);
  const hasBookingOptOut =
    (await prisma.booking.count({
      where: { guestPhone: e164, optedOutAt: { not: null }, apartment: { ownerId } },
    })) > 0;
  const hasHashOptOut =
    (await prisma.optOut.count({
      where: { ownerId, phoneHash },
    })) > 0;
  return hasBookingOptOut || hasHashOptOut;
}
