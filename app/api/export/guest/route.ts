import { requireOwner } from "@/lib/auth";
import { collectGuestData } from "@/lib/guest-data";
import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const session = await requireOwner();
  const { searchParams } = new URL(req.url);
  const bookingId = searchParams.get("bookingId");
  const scope = (searchParams.get("scope") || "booking") as "booking" | "phone";

  if (!bookingId) {
    return NextResponse.json({ error: "bookingId required" }, { status: 400 });
  }

  // Verify ownership
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { apartment: true },
  });

  if (!booking || booking.apartment.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  // Audit log
  await prisma.auditLog.create({
    data: {
      ownerId: session.user.id,
      action: "EXPORT_GUEST",
      targetType: "booking",
      targetId: bookingId,
    },
  });

  const bookingIds = scope === "phone" && booking.guestPhone
    ? (await prisma.booking.findMany({
        where: {
          apartment: { ownerId: session.user.id },
          guestPhone: booking.guestPhone,
        },
        select: { id: true },
      })).map((b) => b.id)
    : [bookingId];

  const data = await collectGuestData(session.user.id, bookingIds);

  return NextResponse.json(data, {
    headers: {
      "Content-Disposition": `attachment; filename="guest-data-${bookingId}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
