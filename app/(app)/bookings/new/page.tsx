import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getLanguage } from "@/lib/languages";
import { isValidYmd } from "@/lib/dates";
import { BookingForm } from "@/components/BookingForm";
import { createBooking } from "../actions";

export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ apartmentId?: string; checkIn?: string; checkOut?: string }>;
}) {
  const owner = await requireOwner();
  const sp = await searchParams;

  const apartments = await prisma.apartment.findMany({
    where: { ownerId: owner.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  if (apartments.length === 0) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Add booking</h1>
        <p className="text-gray-600">
          Add your first apartment to start.{" "}
          <Link className="underline" href="/apartments/new">
            Add apartment
          </Link>
        </p>
      </div>
    );
  }

  // Validate and apply search params
  const apartmentIds = new Set(apartments.map((a) => a.id));
  const initialApartmentId = sp.apartmentId && apartmentIds.has(sp.apartmentId) ? sp.apartmentId : "";
  const initialCheckIn = sp.checkIn && isValidYmd(sp.checkIn) ? sp.checkIn : "";
  const initialCheckOut = sp.checkOut && isValidYmd(sp.checkOut) ? sp.checkOut : "";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Add booking</h1>
        <Link className="text-sm underline" href="/calendar">
          Back to calendar
        </Link>
      </div>

      <BookingForm
        action={createBooking}
        mode="create"
        values={{
          apartmentId: initialApartmentId,
          checkIn: initialCheckIn,
          checkOut: initialCheckOut,
          guestName: "",
          guestPhone: "",
          guestLanguage: "",
          guests: "",
          notes: "",
          guestOptIn: "false",
        }}
        apartments={apartments}
        defaultGuestLanguageName={getLanguage(owner.defaultGuestLanguage)?.name ?? "English"}
        submitLabel="Create booking"
      />
    </div>
  );
}
