"use client";

import { useActionState } from "react";
import { cancelDirectBooking, restoreDirectBooking } from "@/app/(app)/bookings/actions";

type Props = {
  bookingId: string;
  source: string;
  status: string;
};

export function BookingActions({ bookingId, source, status }: Props) {
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelDirectBooking.bind(null, bookingId), undefined);
  const [restoreState, restoreAction, restorePending] = useActionState(
    restoreDirectBooking.bind(null, bookingId),
    undefined
  );

  if (source !== "DIRECT") {
    return (
      <p className="text-sm text-gray-600">
        To cancel, use Airbnb or Booking.com. Ostra updates within the hour.
      </p>
    );
  }

  if (status === "CANCELLED") {
    return (
      <form action={restoreAction} className="flex flex-wrap gap-2">
        {restoreState?.overlaps && restoreState.overlaps.length > 0 && (
          <div className="w-full rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            <p className="font-medium">Restoring would overlap:</p>
            <ul className="mt-1 list-disc pl-5">
              {restoreState.overlaps.map((o) => (
                <li key={o.id}>
                  {o.label} ({o.inYmd} to {o.outYmd})
                </li>
              ))}
            </ul>
          </div>
        )}
        {restoreState?.error && <p className="text-sm text-red-600">{restoreState.error}</p>}
        {restoreState?.overlaps?.length ? (
          <button
            name="confirmOverlap"
            value="1"
            disabled={restorePending}
            className="rounded-md bg-red-700 px-4 py-2 text-white disabled:opacity-50"
          >
            Restore anyway
          </button>
        ) : (
          <button disabled={restorePending} className="rounded-md bg-black px-4 py-2 text-white disabled:opacity-50">
            {restorePending ? "Restoring..." : "Restore booking"}
          </button>
        )}
      </form>
    );
  }

  return (
    <div className="space-y-2">
      {cancelState?.error && <p className="text-sm text-red-600">{cancelState.error}</p>}
      <button
        onClick={() => {
          if (window.confirm("Cancel this booking? Guests keep their history in Ostra, but no more automatic messages will be sent.")) {
            cancelAction(new FormData());
          }
        }}
        disabled={cancelPending}
        className="rounded-md border border-red-600 px-4 py-2 text-red-600 disabled:opacity-50"
      >
        {cancelPending ? "Cancelling..." : "Cancel booking"}
      </button>
    </div>
  );
}
