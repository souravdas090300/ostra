import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadInbox, inboxCounts } from "@/lib/inbox-data";
import { AutoRefresh } from "@/components/AutoRefresh";
import { dismissUnmatched, linkUnmatchedToBooking } from "./actions";
import { formatPhone } from "@/lib/phone";
import Link from "next/link";

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await requireOwner();
  const params = await searchParams;
  const tab = params.tab ?? "needs";
  const counts = await inboxCounts(session.user.id);

  if (tab === "unknown") {
    const unmatched = await prisma.unmatchedMessage.findMany({
      where: { ownerId: session.user.id, handledAt: null, receivedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      orderBy: { receivedAt: "desc" },
    });
    const bookings = await prisma.booking.findMany({
      where: {
        apartment: { ownerId: session.user.id },
        isBlock: false,
        status: "CONFIRMED",
        OR: [
          { checkIn: { lte: new Date(Date.now() + 14 * 86_400_000) }, checkOut: { gte: new Date() } },
          { checkOut: { gte: new Date(Date.now() - 2 * 86_400_000) } },
        ],
      },
      include: { apartment: true },
      orderBy: { checkIn: "asc" },
    });

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Inbox</h1>
          <p className="mt-2 text-sm text-gray-600">Unknown numbers</p>
        </div>

        <div className="flex gap-2 border-b">
          <Link href="/inbox?tab=needs" className="px-4 py-2 text-sm">
            Needs reply ({counts.needs})
          </Link>
          <Link href="/inbox?tab=all" className="px-4 py-2 text-sm">
            All conversations
          </Link>
          <Link href="/inbox?tab=unknown" className="px-4 py-2 text-sm font-medium border-b-2 border-black">
            Unknown numbers ({counts.unknown})
          </Link>
        </div>

        <p className="text-sm text-gray-600">
          Real enquiries from strangers will be answered automatically once enquiry handling is added. Until then, dismiss them or link the number if it is a guest.
        </p>

        {unmatched.length === 0 ? (
          <p className="text-sm text-gray-500">No unknown numbers in the last 30 days.</p>
        ) : (
          <div className="space-y-4">
            {unmatched.map((u) => (
              <div key={u.id} className="rounded-lg border bg-white p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{formatPhone(u.phone)}</span>
                  <span className="text-sm text-gray-500">{new Date(u.receivedAt).toLocaleString()}</span>
                </div>
                <p className="text-sm" dir="auto">
                  {u.hasMedia ? "(photo or voice message)" : u.body}
                </p>
                <div className="flex items-center gap-2">
                  <select id={`booking-${u.id}`} className="rounded-md border px-3 py-2 text-sm">
                    <option value="">Link to booking...</option>
                    {bookings.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.guestName || b.source} - {b.apartment.name} ({b.checkIn.toISOString().slice(0, 10)})
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={async () => {
                      const select = document.getElementById(`booking-${u.id}`) as HTMLSelectElement;
                      if (select.value) {
                        const result = await linkUnmatchedToBooking(u.id, select.value);
                        if (result.error) alert(result.error);
                      }
                    }}
                    className="rounded-md bg-black px-4 py-2 text-sm text-white"
                  >
                    Link and answer
                  </button>
                  <button
                    onClick={async () => {
                      await dismissUnmatched(u.id);
                    }}
                    className="rounded-md border px-4 py-2 text-sm"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const rows = await loadInbox(session.user.id);
  const filtered = tab === "needs" ? rows.filter((r) => r.unresolved > 0) : rows;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Inbox</h1>
        <p className="mt-2 text-sm text-gray-600">
          {tab === "needs" ? "Messages that need your attention" : "All conversations"}
        </p>
      </div>

      <div className="flex gap-2 border-b">
        <Link href="/inbox?tab=needs" className={`px-4 py-2 text-sm ${tab === "needs" ? "font-medium border-b-2 border-black" : ""}`}>
          Needs reply ({counts.needs})
        </Link>
        <Link href="/inbox?tab=all" className={`px-4 py-2 text-sm ${tab === "all" ? "font-medium border-b-2 border-black" : ""}`}>
          All conversations
        </Link>
        <Link href="/inbox?tab=unknown" className="px-4 py-2 text-sm">
          Unknown numbers ({counts.unknown})
        </Link>
      </div>

      <AutoRefresh />

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-500">{tab === "needs" ? "Nothing needs you right now." : "No conversations yet."}</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <Link key={r.bookingId} href={`/inbox/${r.bookingId}`} className="block rounded-lg border bg-white p-4 hover:bg-gray-50">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    {r.urgent && <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Urgent</span>}
                    <span className="font-medium">{r.guestName || "Guest"}</span>
                    <span className="text-sm text-gray-500">{r.apartmentName}</span>
                  </div>
                  <p className="text-sm text-gray-500">
                    {r.inYmd} - {r.outYmd}
                  </p>
                  <p className="text-sm truncate" dir="auto">
                    {r.lastDirection === "OUTBOUND" && (r.lastBody.startsWith("You: ") ? "" : "You: ")}
                    {r.lastBody}
                  </p>
                </div>
                <div className="text-right space-y-1">
                  {r.unresolved > 0 && (
                    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      {r.unresolved} need you
                    </span>
                  )}
                  <p className="text-xs text-gray-500">{new Date(r.lastAt).toLocaleString()}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
