import { prisma } from "./db";
import { maltaYmd } from "./time";
import type { ExportStay } from "./ical-export";

/** Load stays for an apartment within a date range, mapped to ExportStay format. */
export async function loadApartmentStays(
  apartmentId: string,
  fromYmd: string,
  toYmd: string,
): Promise<ExportStay[]> {
  const bookings = await prisma.booking.findMany({
    where: {
      apartmentId,
      status: "CONFIRMED",
      isBlock: false,
      // Overlap logic: booking ends after from AND starts before to
      checkOut: { gt: new Date(`${fromYmd}T00:00:00Z`) },
      checkIn: { lt: new Date(`${toYmd}T00:00:00Z`) },
    },
    select: {
      id: true,
      source: true,
      isBlock: true,
      checkIn: true,
      checkOut: true,
      createdAt: true,
    },
  });

  return bookings.map((b) => ({
    id: b.id,
    source: b.source as "AIRBNB" | "BOOKING_COM" | "DIRECT",
    isBlock: b.isBlock,
    inYmd: maltaYmd(b.checkIn),
    outYmd: maltaYmd(b.checkOut),
    createdAt: b.createdAt,
  }));
}
