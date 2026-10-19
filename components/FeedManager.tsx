"use client";

import React from "react";
import { useActionState, useTransition } from "react";
import { addFeed, removeFeed, syncFeedNow, type FormState } from "@/app/(app)/apartments/actions";

type Feed = { id: string; source: string; icalUrl: string; lastSyncAt: string | null; lastSuccessAt: string | null; lastError: string | null };

export function FeedManager({ apartmentId, feeds }: { apartmentId: string; feeds: Feed[] }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    addFeed.bind(null, apartmentId), undefined,
  );
  const [isPending, startTransition] = useTransition();
  const [syncMessages, setSyncMessages] = React.useState<Record<string, string>>({});

  const handleSync = (feedId: string) => {
    startTransition(async () => {
      const result = await syncFeedNow(feedId);
      setSyncMessages((prev) => ({ ...prev, [feedId]: result.message }));
    });
  };

  const handleRemove = (feedId: string) => {
    if (!confirm("This cancels this link's future bookings in Ostra. They stay on Airbnb/Booking.com.")) return;
    startTransition(async () => {
      await removeFeed(feedId, apartmentId);
    });
  };

  const isStale = (lastSuccessAt: string | null) => {
    if (!lastSuccessAt) return false;
    const hoursSince = (Date.now() - new Date(lastSuccessAt).getTime()) / (1000 * 60 * 60);
    return hoursSince > 3;
  };

  const v = (k: string) => state?.submitted?.[k] ?? "";

  return (
    <section className="max-w-2xl space-y-3">
      <h2 className="font-semibold">Calendar links (iCal)</h2>
      <p className="text-sm text-gray-600">
        Paste the calendar export link from Airbnb and from Booking.com. Ostra reads bookings from it.
      </p>
      <ul className="space-y-2">
        {feeds.map((f) => (
          <li key={f.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{f.source === "AIRBNB" ? "Airbnb" : "Booking.com"}</p>
              <p className="truncate text-xs text-gray-600">{f.icalUrl.slice(0, 48)}...</p>
              <div className="mt-1 space-y-1">
                {f.lastSuccessAt ? (
                  <p className="text-xs text-gray-500">
                    Last successful sync: {new Date(f.lastSuccessAt).toLocaleString()}
                    {isStale(f.lastSuccessAt) && (
                      <span className="ml-2 text-amber-600 font-medium">(stale)</span>
                    )}
                  </p>
                ) : (
                  <p className="text-xs text-gray-500">Not synced yet</p>
                )}
                {f.lastError && <p className="text-xs text-red-600">Last error: {f.lastError}</p>}
                {syncMessages[f.id] && (
                  <p className={`text-xs ${syncMessages[f.id].startsWith("Done") ? "text-green-600" : "text-red-600"}`}>
                    {syncMessages[f.id]}
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleSync(f.id)}
                disabled={isPending}
                className="text-sm text-blue-600 underline disabled:opacity-50"
              >
                Sync now
              </button>
              <button
                onClick={() => handleRemove(f.id)}
                disabled={isPending}
                className="text-sm text-red-600 underline disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
      <form action={formAction} className="space-y-2 rounded-md border p-3">
        <select name="source" defaultValue={v("source")} className="w-full rounded-md border px-3 py-2">
          <option value="AIRBNB">Airbnb</option>
          <option value="BOOKING_COM">Booking.com</option>
        </select>
        <input name="icalUrl" placeholder="https://..." defaultValue={v("icalUrl")} className="w-full rounded-md border px-3 py-2" />
        {state?.fieldErrors?.icalUrl?.map((m) => <p key={m} className="text-sm text-red-600">{m}</p>)}
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button disabled={pending} className="rounded-md bg-black px-3 py-2 text-white disabled:opacity-50">Add link</button>
      </form>
    </section>
  );
}
