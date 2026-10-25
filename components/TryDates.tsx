"use client";

import { useState } from "react";
import { tryDates } from "@/app/(app)/apartments/actions";
import { reasonToText } from "@/lib/availability-core";

export function TryDates({ apartmentId }: { apartmentId: string }) {
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [guests, setGuests] = useState("2");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const handleCheck = async () => {
    setError(undefined);
    setResult(undefined);
    setLoading(true);

    try {
      if (!checkIn || !checkOut || !guests) {
        setError("Please fill in all fields");
        setLoading(false);
        return;
      }

      const guestsNum = Number(guests);
      if (guestsNum < 1 || guestsNum > 30) {
        setError("Guests must be between 1 and 30");
        setLoading(false);
        return;
      }

      const response = await tryDates(apartmentId, checkIn, checkOut, guestsNum);

      if (!response.ok) {
        setError(response.error || "Failed to check availability");
      } else {
        setResult(response.result);
      }
    } catch (e) {
      setError("Failed to check availability");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Try dates</h2>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Check-in</label>
          <input
            type="date"
            value={checkIn}
            onChange={(e) => setCheckIn(e.target.value)}
            className="w-full px-2 py-1 border rounded text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Check-out</label>
          <input
            type="date"
            value={checkOut}
            onChange={(e) => setCheckOut(e.target.value)}
            className="w-full px-2 py-1 border rounded text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Guests</label>
          <input
            type="number"
            value={guests}
            onChange={(e) => setGuests(e.target.value)}
            min="1"
            max="30"
            className="w-full px-2 py-1 border rounded text-sm"
          />
        </div>
      </div>
      <button
        type="button"
        onClick={handleCheck}
        disabled={loading}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
      >
        {loading ? "Checking..." : "Check availability"}
      </button>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {result && (
        <div className="p-4 bg-gray-50 rounded">
          {result.available ? (
            <div className="space-y-2">
              <p className="text-green-600 font-medium">Available</p>
              <p className="text-sm">{result.nights} nights</p>
              <p className="text-sm">
                Total: €{(result.totalCents! / 100).toFixed(2)}
                {result.cleaningFeeCents && ` (incl. €${(result.cleaningFeeCents / 100).toFixed(2)} cleaning fee)`}
              </p>
              {result.nightly && result.nightly.length > 0 && (
                <div className="text-sm">
                  <p className="font-medium mt-2">Nightly breakdown:</p>
                  {result.nightly.map((n: any) => (
                    <div key={n.date} className="flex justify-between">
                      <span>{n.date}</span>
                      <span>€{(n.cents / 100).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <p className="text-red-600 font-medium">Not available</p>
              <p className="text-sm">{result.reason ? reasonToText(result.reason as any) : "Not available"}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
