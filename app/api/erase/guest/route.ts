import { requireOwner } from "@/lib/auth";
import { eraseGuestData } from "@/lib/guest-data";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const session = await requireOwner();
  const body = await req.json();
  const { bookingId, scope } = body as { bookingId: string; scope: "booking" | "phone" };

  if (!bookingId || !scope) {
    return NextResponse.json({ error: "bookingId and scope required" }, { status: 400 });
  }

  if (scope !== "booking" && scope !== "phone") {
    return NextResponse.json({ error: "scope must be 'booking' or 'phone'" }, { status: 400 });
  }

  const result = await eraseGuestData(session.id, bookingId, scope);

  return NextResponse.json(result);
}
