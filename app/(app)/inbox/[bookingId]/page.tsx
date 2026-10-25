import { requireOwner } from "@/lib/auth";
import { loadThread } from "@/lib/inbox-data";
import { windowOpen } from "@/lib/reply-window";
import { getLanguage } from "@/lib/languages";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Composer } from "@/components/Composer";
import { MessageList } from "@/components/MessageList";
import { AttentionBanner } from "@/components/AttentionBanner";
import { ReplyWindowBanner } from "@/components/ReplyWindowBanner";
import { resolveConversation, reopenMessage } from "../actions";
import Link from "next/link";

export default async function ThreadPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  const session = await requireOwner();
  const t = await loadThread(session.id, bookingId);
  if (!t) return <div>Not found</div>;

  const { booking, messages, lastGuestAt, lastDetected, unresolved } = t;
  const guestLanguage = booking.guestLanguage ?? lastDetected ?? session.defaultGuestLanguage;
  const sameLanguage = guestLanguage === session.hostLanguage;
  const now = new Date();
  const open = windowOpen(lastGuestAt, now);
  const guestLangName = getLanguage(guestLanguage)?.name ?? guestLanguage;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/inbox" className="text-sm text-gray-600 hover:text-gray-900">
          ← Back
        </Link>
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

      <AttentionBanner
        unresolved={unresolved}
        onResolve={async () => {
          await resolveConversation(booking.id);
        }}
      />

      <ReplyWindowBanner lastGuestAt={lastGuestAt} now={now} />

      <MessageList
        messages={messages}
        onReopen={async (messageId) => {
          await reopenMessage(messageId);
        }}
        showFeedback={true}
      />

      <Composer
        bookingId={booking.id}
        windowOpen={open}
        hasPhone={!!booking.guestPhone}
        hostLanguage={session.hostLanguage}
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
