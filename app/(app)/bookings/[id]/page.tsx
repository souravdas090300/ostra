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
import { updateBooking, setMessagesPaused } from "../actions";

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
      apartment: true,
    },
  });

  if (!booking) return <div>Booking not found</div>;

  const inYmd = maltaYmd(booking.checkIn);
  const outYmd = maltaYmd(booking.checkOut);
  const nights = diffDays(inYmd, outYmd);
  const today = todayMalta();
  const isFuture = inYmd >= today;

  // Check for overlaps
  const overlaps = await findOverlaps(owner.user.id, booking.apartmentId, inYmd, outYmd, booking.id);
  const bookingOverlap = overlaps.find((o) => o.kind === "BOOKING");

  // Check for guest count exceed
  const guestCountExceeds = booking.guests && booking.guests > booking.apartment.maxGuests;

  const created = sp.created === "1" && booking.source === "DIRECT";

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
            {booking.source === "DIRECT" && !booking.isBlock && booking.status === "CONFIRMED" && isFuture && (
              <PlatformBlockNotice apartmentName={booking.apartment.name} inYmd={inYmd} outYmd={outYmd} />
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
              <p className="text-sm text-gray-600">Scheduled messages will appear here.</p>
            </div>
          </div>

          {/* Message history section */}
          <div className="rounded-lg border bg-white p-4">
            <h3 className="text-lg font-semibold">Message history</h3>
            <p className="mt-4 text-sm text-gray-600">No messages yet.</p>
          </div>

          {/* Cancel/Restore section */}
          <div className="rounded-lg border bg-white p-4">
            <h3 className="text-lg font-semibold">Actions</h3>
            <div className="mt-4">
              <BookingActions bookingId={booking.id} source={booking.source} status={booking.status} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
