"use client";

import { useActionState } from "react";
import { addFeed, removeFeed, type FormState } from "@/app/(app)/apartments/actions";

type Feed = { id: string; source: string; icalUrl: string; lastSyncAt: string | null; lastError: string | null };

export function FeedManager({ apartmentId, feeds }: { apartmentId: string; feeds: Feed[] }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    addFeed.bind(null, apartmentId), undefined,
  );
  return (
    <section className="max-w-2xl space-y-3">
      <h2 className="font-semibold">Calendar links (iCal)</h2>
      <p className="text-sm text-gray-600">
        Paste the calendar export link from Airbnb and from Booking.com. Ostra reads bookings from it.
      </p>
      <ul className="space-y-2">
        {feeds.map((f) => (
          <li key={f.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{f.source === "AIRBNB" ? "Airbnb" : "Booking.com"}</p>
              <p className="truncate text-xs text-gray-600">{f.icalUrl.slice(0, 48)}...</p>
              <p className="text-xs text-gray-500">
                {f.lastSyncAt ? `Last synced ${new Date(f.lastSyncAt).toLocaleString()}` : "Not synced yet"}
              </p>
              {f.lastError && <p className="text-xs text-red-600">Last error: {f.lastError}</p>}
            </div>
            <form action={removeFeed.bind(null, f.id, apartmentId)}>
              <button className="text-sm text-red-600 underline">Remove</button>
            </form>
          </li>
        ))}
      </ul>
      <form action={formAction} className="space-y-2 rounded-md border p-3">
        <select name="source" className="w-full rounded-md border px-3 py-2">
          <option value="AIRBNB">Airbnb</option>
          <option value="BOOKING_COM">Booking.com</option>
        </select>
        <input name="icalUrl" placeholder="https://..." className="w-full rounded-md border px-3 py-2" />
        {state?.fieldErrors?.icalUrl?.map((m) => <p key={m} className="text-sm text-red-600">{m}</p>)}
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button disabled={pending} className="rounded-md bg-black px-3 py-2 text-white disabled:opacity-50">Add link</button>
      </form>
    </section>
  );
}
