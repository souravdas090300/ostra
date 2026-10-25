import { requireOwner } from "@/lib/auth";
import { loadLeadThread } from "@/lib/lead-data";
import { windowOpen } from "@/lib/reply-window";
import { getLanguage } from "@/lib/languages";
import { LeadComposer } from "@/components/LeadComposer";
import { LeadToBookingForm } from "@/components/LeadToBookingForm";
import { LeadDataProtection } from "@/components/LeadDataProtection";
import { MessageList } from "@/components/MessageList";
import { AttentionBanner } from "@/components/AttentionBanner";
import { ReplyWindowBanner } from "@/components/ReplyWindowBanner";
import { resolveLeadConversation, reopenLeadMessage } from "../actions";
import Link from "next/link";
import { prisma } from "@/lib/db";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireOwner();
  const t = await loadLeadThread(session.id, id);
  if (!t) return <div>Not found</div>;

  const { lead, messages, lastGuestAt, lastDetected, unresolved } = t;
  const guestLanguage = lead.language ?? lastDetected ?? session.defaultGuestLanguage;
  const sameLanguage = guestLanguage === session.hostLanguage;
  const now = new Date();
  const open = windowOpen(lastGuestAt, now);
  const guestLangName = getLanguage(guestLanguage)?.name ?? guestLanguage;

  const apartments = await prisma.apartment.findMany({
    where: { ownerId: session.id },
    select: { id: true, name: true },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/leads" className="text-sm text-gray-600 hover:text-gray-900">
          ← Back
        </Link>
      </div>

      <div>
        <h1 className="text-xl font-semibold">{lead.name || "Guest"}</h1>
        <p className="mt-1 text-sm text-gray-600">
          {lead.phone}
        </p>
        {lead.apartment && (
          <p className="mt-1 text-sm text-gray-600">
            {lead.apartment.name}
          </p>
        )}
        {lead.checkIn && lead.checkOut && (
          <p className="mt-1 text-sm text-gray-600">
            {lead.checkIn.toISOString().slice(0, 10)} - {lead.checkOut.toISOString().slice(0, 10)}
            {lead.guests && ` (${lead.guests} guest${lead.guests > 1 ? 's' : ''})`}
          </p>
        )}
        {lead.quotedCents && (
          <p className="mt-1 text-sm text-gray-600">
            Quoted: €{(lead.quotedCents / 100).toFixed(2)}
          </p>
        )}
        <span className="mt-1 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800">
          {guestLangName}
        </span>
      </div>

      <AttentionBanner
        unresolved={unresolved}
        onResolve={async () => {
          await resolveLeadConversation(lead.id);
        }}
      />

      <ReplyWindowBanner lastGuestAt={lastGuestAt} now={now} />

      <MessageList
        messages={messages}
        onReopen={async (messageId) => {
          await reopenLeadMessage(messageId);
        }}
        showFeedback={false}
      />

      <LeadComposer
        leadId={lead.id}
        windowOpen={open}
        hostLanguage={session.hostLanguage}
        guestLanguage={guestLanguage}
        sameLanguage={sameLanguage}
        hasUnresolved={unresolved.length > 0}
        suggestedQuestion={unresolved[0]?.hostSummary ?? ""}
      />

      {lead.status !== "BOOKED" && lead.checkIn && lead.checkOut && lead.guests && lead.name && (
        <div className="border rounded-lg p-4 space-y-4">
          <h2 className="font-medium">Convert to Booking</h2>
          <p className="text-sm text-gray-600">
            This lead has all the details needed to create a booking.
          </p>
          <LeadToBookingForm
            leadId={lead.id}
            initialApartmentId={lead.apartmentId}
            initialCheckIn={lead.checkIn.toISOString().slice(0, 10)}
            initialCheckOut={lead.checkOut.toISOString().slice(0, 10)}
            initialGuests={lead.guests}
            initialName={lead.name}
            apartments={apartments}
          />
        </div>
      )}

      <LeadDataProtection leadId={lead.id} />
    </div>
  );
}
