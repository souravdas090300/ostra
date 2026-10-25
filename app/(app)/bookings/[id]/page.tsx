import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { maltaYmd } from "@/lib/time";
import { formatYmd, diffDays, todayMalta } from "@/lib/dates";
import { SOURCE_LABEL, SOURCE_LETTER } from "@/lib/calendar-view";
import { findOverlaps } from "@/lib/booking-overlaps";
import { getLanguage } from "@/lib/languages";
import { formatPhone } from "@/lib/phone";
import { BookingForm } from "@/components/BookingForm";
import { PlatformBlockNotice } from "@/components/PlatformBlockNotice";
import { BookingActions } from "@/components/BookingActions";
import { PrivacyActions } from "@/components/PrivacyActions";
import { updateBooking, setMessagesPaused, skipScheduledMessage } from "../actions";
import { linkState, type LinkState } from "@/lib/export-feeds";

export default async function BookingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const owner = await requireOwner();
  const { id } = await params;
  const sp = await searchParams;

  const booking = await prisma.booking.findFirst({
    where: { id, apartment: { ownerId: owner.user.id } },
    include: {
      apartment: {
        include: {
          exportFeeds: true,
        },
      },
      scheduled: true,
      messages: true,
    },
  });

  if (!booking) return <div>Booking not found</div>;

  const inYmd = maltaYmd(booking.checkIn);
  const outYmd = maltaYmd(booking.checkOut);
  const nights = diffDays(inYmd, outYmd);
  const today = todayMalta();
  const isFuture = inYmd >= today;
  const now = new Date();

  // Check for overlaps
  const overlaps = await findOverlaps(owner.user.id, booking.apartmentId, inYmd, outYmd, booking.id);
  const bookingOverlap = overlaps.find((o) => o.kind === "BOOKING");

  // Check for guest count exceed
  const guestCountExceeds = booking.guests && booking.guests > booking.apartment.maxGuests;

  const created = sp.created === "1" && booking.source === "DIRECT";

  // Build export feed states
  const exportStates: Record<"AIRBNB" | "BOOKING_COM", LinkState> = {
    AIRBNB: "DISABLED",
    BOOKING_COM: "DISABLED",
  };
  const lastFetched: Record<"AIRBNB" | "BOOKING_COM", Date | null> = {
    AIRBNB: null,
    BOOKING_COM: null,
  };
  for (const feed of booking.apartment.exportFeeds) {
    if (feed.target === "AIRBNB") {
      exportStates.AIRBNB = linkState(feed, now);
      lastFetched.AIRBNB = feed.lastFetchedAt;
    } else if (feed.target === "BOOKING_COM") {
      exportStates.BOOKING_COM = linkState(feed, now);
      lastFetched.BOOKING_COM = feed.lastFetchedAt;
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Booking</h1>
        <Link className="text-sm underline" href="/calendar">
          Back to calendar
        </Link>
      </div>

      {created && (
        <div className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">
          Booking saved.
        </div>
      )}

      {booking.isBlock ? (
        <div className="rounded-lg border bg-white p-4">
          <h2 className="text-lg font-semibold">Blocked dates</h2>
          <p className="mt-2 text-sm text-gray-600">Dates closed on the platform. They are not available to sell.</p>
          <div className="mt-4 space-y-2 text-sm">
            <p>
              <span className="font-medium">Apartment:</span>{" "}
              <Link className="underline" href={`/apartments/${booking.apartment.id}`}>
                {booking.apartment.name}
              </Link>
            </p>
            <p>
              <span className="font-medium">Dates:</span> {formatYmd(inYmd)} to {formatYmd(outYmd)} ({nights} nights)
            </p>
            <p>
              <span className="font-medium">Source:</span> {SOURCE_LABEL[booking.source as keyof typeof SOURCE_LABEL]}
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="rounded-lg border bg-white p-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">{booking.guestName ?? SOURCE_LABEL[booking.source as keyof typeof SOURCE_LABEL]}</h2>
                <div className="mt-1 flex items-center gap-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-xs font-bold">
                    {SOURCE_LETTER[booking.source as keyof typeof SOURCE_LETTER]}
                  </span>
                  <span className="text-sm text-gray-600">{SOURCE_LABEL[booking.source as keyof typeof SOURCE_LABEL]}</span>
                  {booking.status === "CANCELLED" && (
                    <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                      Cancelled
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Banners */}
            {bookingOverlap && (
              <div className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
                This stay overlaps {bookingOverlap.label} ({formatYmd(bookingOverlap.inYmd)} to{" "}
                {formatYmd(bookingOverlap.outYmd)})
              </div>
            )}
            {guestCountExceeds && (
              <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                More guests than the apartment&apos;s maximum ({booking.apartment.maxGuests})
              </div>
            )}
            {!booking.guestPhone && (
              <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                Add a WhatsApp number to switch on automatic messages.
              </div>
            )}
            {!booking.isBlock && booking.status === "CONFIRMED" && isFuture && (
              <PlatformBlockNotice
                apartmentName={booking.apartment.name}
                inYmd={inYmd}
                outYmd={outYmd}
                source={booking.source as "DIRECT" | "AIRBNB" | "BOOKING_COM"}
                states={exportStates}
                lastFetched={lastFetched}
                now={now}
              />
            )}
          </div>

          {/* Stay section */}
          <div className="rounded-lg border bg-white p-4">
            <h3 className="text-lg font-semibold">Stay</h3>
            <div className="mt-4 space-y-2 text-sm">
              <p>
                <span className="font-medium">Apartment:</span>{" "}
                <Link className="underline" href={`/apartments/${booking.apartment.id}`}>
                  {booking.apartment.name}
                </Link>
              </p>
              <p>
                <span className="font-medium">Dates:</span> {formatYmd(inYmd)} to {formatYmd(outYmd)} ({nights} nights)
              </p>
              <p>
                <span className="font-medium">Times:</span> {booking.apartment.checkInTime} check-in, {booking.apartment.checkOutTime} check-out
              </p>
              <p>
                <span className="font-medium">Source:</span> {SOURCE_LABEL[booking.source as keyof typeof SOURCE_LABEL]}
              </p>
              {booking.guests && (
                <p>
                  <span className="font-medium">Guests:</span> {booking.guests}
                </p>
              )}
            </div>
          </div>

          {/* Guest section */}
          {booking.status === "CANCELLED" ? (
            <div className="rounded-lg border bg-white p-4">
              <h3 className="text-lg font-semibold">Guest details</h3>
              <div className="mt-4 space-y-2 text-sm">
                <p>
                  <span className="font-medium">Name:</span> {booking.guestName ?? "Not set"}
                </p>
                <p>
                  <span className="font-medium">Phone:</span> {booking.guestPhone ? formatPhone(booking.guestPhone) : "Not set"}
                </p>
                <p>
                  <span className="font-medium">Language:</span>{" "}
                  {booking.guestLanguage ? getLanguage(booking.guestLanguage)?.name : "Not set"}
                </p>
                {booking.notes && (
                  <p>
                    <span className="font-medium">Notes:</span> {booking.notes}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border bg-white p-4">
              <h3 className="text-lg font-semibold">Guest details</h3>
              <BookingForm
                action={updateBooking.bind(null, booking.id)}
                mode={booking.source === "DIRECT" ? "edit-direct" : "edit-synced"}
                values={{
                  apartmentId: booking.apartmentId,
                  checkIn: inYmd,
                  checkOut: outYmd,
                  guestName: booking.guestName ?? "",
                  guestPhone: booking.guestPhone ?? "",
                  guestLanguage: booking.guestLanguage ?? "",
                  guests: booking.guests?.toString() ?? "",
                  notes: booking.notes ?? "",
                  guestOptIn: !!booking.optedInAt ? "true" : "",
                }}
                defaultGuestLanguageName={getLanguage(owner.user.defaultGuestLanguage)?.name ?? "English"}
                submitLabel="Save"
              />
            </div>
          )}

          {/* Automatic messages section */}
          <div className="rounded-lg border bg-white p-4">
            <h3 className="text-lg font-semibold">Automatic messages</h3>
            <div className="mt-4 space-y-4">
              <form action={setMessagesPaused.bind(null, booking.id, !booking.messagesPaused)}>
                <button
                  type="submit"
                  className="rounded-md border px-4 py-2 text-sm"
                >
                  {booking.messagesPaused ? "Resume automatic messages" : "Pause automatic messages"}
                </button>
              </form>
              {booking.scheduled.length === 0 ? (
                <p className="text-sm text-gray-600">No scheduled messages. Add a phone number and opt-in to enable.</p>
              ) : (
                <div className="space-y-2">
                  {booking.scheduled.map((msg) => {
                    const message = booking.messages.find((m) => m.scheduledMessageId === msg.id);
                    return (
                      <div key={msg.id} className="flex items-center justify-between rounded border p-3 text-sm">
                        <div>
                          <span className="font-medium">{msg.type.replace(/_/g, " ")}</span>
                          <span className="ml-2 text-gray-600">
                            {msg.status === "PENDING" && `Scheduled for ${new Date(msg.sendAt).toLocaleString()}`}
                            {msg.status === "SENT" && `Sent ${new Date(msg.sentAt!).toLocaleString()}`}
                            {msg.status === "SKIPPED" && `Skipped: ${msg.skipReason}`}
                            {msg.status === "FAILED" && `Failed: ${msg.lastError}`}
                            {msg.status === "CANCELLED" && "Cancelled"}
                            {msg.status === "SENDING" && "Sending..."}
                          </span>
                          {msg.language && <span className="ml-2 text-xs text-gray-500">({msg.language})</span>}
                          {message && message.deliveryStatus && (
                            <span className="ml-2 text-xs">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                message.deliveryStatus === "delivered" || message.deliveryStatus === "read"
                                  ? "bg-green-100 text-green-800"
                                  : message.deliveryStatus === "failed" || message.deliveryStatus === "undelivered"
                                  ? "bg-red-100 text-red-800"
                                  : "bg-gray-100 text-gray-800"
                              }`}>
                                {message.deliveryStatus}
                              </span>
                            </span>
                          )}
                        </div>
                        {msg.status === "PENDING" && (
                          <form action={skipScheduledMessage.bind(null, msg.id)}>
                            <button
                              type="submit"
                              className="text-red-600 hover:text-red-900 text-sm"
                            >
                              Skip
                            </button>
                          </form>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Message history section */}
          <div className="rounded-lg border bg-white p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Message history</h3>
              <Link href={`/inbox/${booking.id}`} className="text-sm text-blue-600 hover:text-blue-800">
                Open conversation
              </Link>
            </div>
            {booking.messages.length === 0 ? (
              <p className="mt-4 text-sm text-gray-600">No messages yet.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {booking.messages.map((m) => (
                  <div key={m.id} className="rounded border p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {m.author === "GUEST" && "Guest"}
                          {m.author === "AI" && "Assistant"}
                          {m.author === "HOST" && "Host"}
                          {m.author === "SYSTEM" && "Automatic"}
                        </span>
                        {m.direction === "INBOUND" && <span className="text-gray-500">→</span>}
                        {m.direction === "OUTBOUND" && <span className="text-gray-500">←</span>}
                        {m.language && <span className="text-xs text-gray-500">({m.language})</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        {m.escalated && (
                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                            Escalated
                          </span>
                        )}
                        {m.urgent && (
                          <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                            Urgent
                          </span>
                        )}
                        {m.hasMedia && (
                          <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                            Photo/Voice
                          </span>
                        )}
                        {m.deliveryStatus && (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              m.deliveryStatus === "delivered" || m.deliveryStatus === "read"
                                ? "bg-green-100 text-green-800"
                                : m.deliveryStatus === "failed" || m.deliveryStatus === "undelivered"
                                  ? "bg-red-100 text-red-800"
                                  : "bg-gray-100 text-gray-800"
                            }`}
                          >
                            {m.deliveryStatus}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap" dir="auto">
                      {m.body}
                    </p>
                    {m.escalated && m.hostSummary && (
                      <p className="mt-2 text-xs text-gray-600">Summary for host: {m.hostSummary}</p>
                    )}
                    {m.escalated && m.escalationReason && (
                      <p className="mt-1 text-xs text-gray-500">Reason: {m.escalationReason}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Cancel/Restore section */}
          <div className="rounded-lg border bg-white p-4">
            <h3 className="text-lg font-semibold">Actions</h3>
            <div className="mt-4">
              <BookingActions bookingId={booking.id} source={booking.source} status={booking.status} />
            </div>
          </div>

          {/* Privacy section */}
          {!booking.isBlock && (
            <div className="rounded-lg border bg-white p-4">
              <h3 className="text-lg font-semibold">Privacy</h3>
              <p className="mt-2 text-sm text-gray-600">
                Export or delete guest data in accordance with GDPR rights.
              </p>
              <div className="mt-4">
                <PrivacyActions bookingId={booking.id} hasPhone={!!booking.guestPhone} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
