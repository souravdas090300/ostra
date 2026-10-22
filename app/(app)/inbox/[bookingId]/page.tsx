import { requireOwner } from "@/lib/auth";
import { loadThread } from "@/lib/inbox-data";
import { windowOpen, windowEnd } from "@/lib/reply-window";
import { getLanguage } from "@/lib/languages";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Composer } from "@/components/Composer";
import { resolveConversation, reopenMessage } from "../actions";
import Link from "next/link";

export default async function ThreadPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  const owner = await requireOwner();
  const t = await loadThread(owner.id, bookingId);
  if (!t) return <div>Not found</div>;

  const { booking, messages, lastGuestAt, lastDetected, unresolved } = t;
  const guestLanguage = booking.guestLanguage ?? lastDetected ?? owner.defaultGuestLanguage;
  const sameLanguage = guestLanguage === owner.hostLanguage;
  const now = new Date();
  const open = windowOpen(lastGuestAt, now);
  const guestLangName = getLanguage(guestLanguage)?.name ?? guestLanguage;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <a href="/inbox" className="text-sm text-gray-600 hover:text-gray-900">
          ← Back
        </a>
      </div>

      <div>
        <h1 className="text-xl font-semibold">{booking.guestName || "Guest"}</h1>
        <p className="mt-1 text-sm text-gray-600">
          {booking.apartment.name} · {booking.checkIn.toISOString().slice(0, 10)} - {booking.checkOut.toISOString().slice(0, 10)}
        </p>
        <a href={`/bookings/${booking.id}`} className="mt-1 text-sm text-blue-600 hover:text-blue-800">
          Booking details
        </a>
        <span className="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800">
          {guestLangName}
        </span>
      </div>

      {unresolved.length > 0 && (
        <div className="rounded-lg border bg-amber-50 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Needs your attention</h2>
            <button
              onClick={async () => {
                await resolveConversation(booking.id);
              }}
              className="rounded-md border px-3 py-1 text-sm"
            >
              Mark resolved
            </button>
          </div>
          {unresolved.slice(0, 1).map((m) => (
            <div key={m.id} className="space-y-1">
              {m.urgent && <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Urgent</span>}
              <p className="text-sm">{m.hostSummary}</p>
              {m.escalationReason && <p className="text-xs text-gray-600">{m.escalationReason}</p>}
            </div>
          ))}
        </div>
      )}

      <div className={`rounded-lg border p-4 ${open ? "bg-green-50" : "bg-amber-50"}`}>
        <p className="text-sm">
          {open ? (
            <>You can reply until {windowEnd(lastGuestAt)?.toLocaleString()}</>
          ) : (
            "The 24-hour reply window has closed. WhatsApp only allows a reply within 24 hours of the guest's last message."
          )}
        </p>
      </div>

      <div className="space-y-3">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.direction === "INBOUND" ? "justify-start" : "justify-end"}`}>
            <div className={`max-w-[80%] rounded-lg p-3 ${m.direction === "INBOUND" ? "bg-gray-100" : "bg-blue-100"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">{m.author === "GUEST" ? "Guest" : m.author === "AI" ? "Assistant" : m.author === "HOST" ? "You" : "Automatic"}</span>
                <span className="text-xs text-gray-500">{new Date(m.createdAt).toLocaleString()}</span>
              </div>
              {m.hasMedia && <p className="text-xs text-gray-600 mt-1">(photo or voice message)</p>}
              <p className="mt-1 text-sm" dir="auto">
                {m.body}
              </p>
              {m.direction === "OUTBOUND" && (
                <p className="mt-1 text-xs text-gray-600">
                  {m.deliveryStatus === "failed" ? (
                    <span className="text-red-600">Failed</span>
                  ) : (
                    m.deliveryStatus
                  )}
                </p>
              )}
              {m.originalBody && (
                <details className="mt-2">
                  <summary className="text-xs text-gray-600 cursor-pointer">What you wrote</summary>
                  <p className="mt-1 text-sm" dir="auto">
                    {m.originalBody}
                  </p>
                </details>
              )}
              {m.escalated && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Escalated</span>
                  {m.resolved ? (
                    <button
                      onClick={async () => {
                        await reopenMessage(m.id);
                      }}
                      className="text-xs text-blue-600 hover:text-blue-800"
                    >
                      Reopen
                    </button>
                  ) : (
                    <span className="text-xs text-green-600">Resolved</span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <Composer
        bookingId={booking.id}
        windowOpen={open}
        hasPhone={!!booking.guestPhone}
        hostLanguage={owner.hostLanguage}
        guestLanguage={guestLanguage}
        sameLanguage={sameLanguage}
        hasUnresolved={unresolved.length > 0}
        apartmentId={booking.apartmentId}
        suggestedQuestion={unresolved[0]?.hostSummary ?? ""}
      />

      <AutoRefresh />
    </div>
  );
}
