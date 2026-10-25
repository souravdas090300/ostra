"use client";

import { useState } from "react";
import { convertLeadToBooking } from "@/app/(app)/leads/actions";

type Props = {
  leadId: string;
  initialApartmentId: string | null;
  initialCheckIn: string;
  initialCheckOut: string;
  initialGuests: number | null;
  initialName: string | null;
  apartments: { id: string; name: string }[];
};

export function LeadToBookingForm({
  leadId,
  initialApartmentId,
  initialCheckIn,
  initialCheckOut,
  initialGuests,
  initialName,
  apartments,
}: Props) {
  const [apartmentId, setApartmentId] = useState(initialApartmentId || "");
  const [checkIn, setCheckIn] = useState(initialCheckIn);
  const [checkOut, setCheckOut] = useState(initialCheckOut);
  const [guests, setGuests] = useState(initialGuests || 1);
  const [guestName, setGuestName] = useState(initialName || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const result = await convertLeadToBooking(leadId, apartmentId, checkIn, checkOut, guests, guestName);
    setLoading(false);

    if (result.error) {
      setError(result.error);
    } else {
      window.location.href = "/bookings";
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-sm font-medium">Apartment</label>
        <select
          value={apartmentId}
          onChange={(e) => setApartmentId(e.target.value)}
          className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
          required
        >
          <option value="">Select apartment</option>
          {apartments.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium">Check-in</label>
          <input
            type="date"
            value={checkIn}
            onChange={(e) => setCheckIn(e.target.value)}
            className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Check-out</label>
          <input
            type="date"
            value={checkOut}
            onChange={(e) => setCheckOut(e.target.value)}
            className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            required
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium">Guests</label>
        <input
          type="number"
          value={guests}
          onChange={(e) => setGuests(Number(e.target.value))}
          min="1"
          max="30"
          className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium">Guest Name</label>
        <input
          type="text"
          value={guestName}
          onChange={(e) => setGuestName(e.target.value)}
          className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
          required
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {loading ? "Creating..." : "Create Booking"}
      </button>
    </form>
  );
}
