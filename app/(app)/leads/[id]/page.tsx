import { requireOwner } from "@/lib/auth";
import { loadLeadThread } from "@/lib/lead-data";
import { windowOpen, windowEnd } from "@/lib/reply-window";
import { getLanguage } from "@/lib/languages";
import { LeadComposer } from "@/components/LeadComposer";
import { LeadToBookingForm } from "@/components/LeadToBookingForm";
import { LeadDataProtection } from "@/components/LeadDataProtection";
import { resolveLeadConversation, reopenLeadMessage } from "../actions";
import Link from "next/link";
import { prisma } from "@/lib/db";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireOwner();
  const t = await loadLeadThread(session.user.id, id);
  if (!t) return <div>Not found</div>;

  const { lead, messages, lastGuestAt, lastDetected, unresolved } = t;
  const guestLanguage = lead.language ?? lastDetected ?? session.user.defaultGuestLanguage;
  const sameLanguage = guestLanguage === session.user.hostLanguage;
  const now = new Date();
  const open = windowOpen(lastGuestAt, now);
  const guestLangName = getLanguage(guestLanguage)?.name ?? guestLanguage;

  const apartments = await prisma.apartment.findMany({
    where: { ownerId: session.user.id },
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

      {unresolved.length > 0 && (
        <div className="rounded-lg border bg-amber-50 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Needs your attention</h2>
            <button
              onClick={async () => {
                await resolveLeadConversation(lead.id);
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
                        await reopenLeadMessage(m.id);
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

      <LeadComposer
        leadId={lead.id}
        windowOpen={open}
        hostLanguage={session.user.hostLanguage}
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
