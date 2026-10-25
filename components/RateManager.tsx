"use client";

import { useState } from "react";
import { addRate, updateRate, deleteRate, type FormState } from "@/app/(app)/apartments/actions";

type Rate = {
  id: string;
  startDate: string;
  endDate: string;
  nightlyCents: number;
  minNights: number | null;
};

export function RateManager({ apartmentId, rates }: { apartmentId: string; rates: Rate[] }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formState, setFormState] = useState<FormState>();

  const sortedRates = [...rates].sort((a, b) => a.startDate.localeCompare(b.startDate));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Prices</h2>
        {!showAdd && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Add rate
          </button>
        )}
      </div>

      <p className="text-sm text-gray-600">
        Prices you enter here are what the assistant quotes to strangers. Rates may overlap; the narrowest rate covering a night wins.
      </p>

      {showAdd && (
        <RateForm
          apartmentId={apartmentId}
          onSubmit={async (fd): Promise<FormState> => {
            const result = await addRate(apartmentId, formState, fd);
            setFormState(result);
            if (result && result.ok) {
              setShowAdd(false);
              setFormState(undefined);
              window.location.reload();
            }
            return result || { error: "Unknown error" };
          }}
          onCancel={() => setShowAdd(false)}
          formState={formState}
        />
      )}

      {sortedRates.length === 0 && !showAdd && (
        <p className="text-sm text-gray-500 italic">No seasonal rates set. Base price applies year-round.</p>
      )}

      <div className="space-y-2">
        {sortedRates.map((rate) => (
          <div key={rate.id} className="flex items-center justify-between p-3 bg-gray-50 rounded">
            {editingId === rate.id ? (
              <RateForm
                apartmentId={apartmentId}
                rate={rate}
                onSubmit={async (fd): Promise<FormState> => {
                  const result = await updateRate(rate.id, formState, fd);
                  setFormState(result);
                  if (result && result.ok) {
                    setEditingId(null);
                    setFormState(undefined);
                    window.location.reload();
                  }
                  return result || { error: "Unknown error" };
                }}
                onCancel={() => setEditingId(null)}
                formState={formState}
              />
            ) : (
              <>
                <div className="flex-1">
                  <div className="text-sm">
                    <span className="font-medium">{formatDate(rate.startDate)}</span>
                    {" – "}
                    <span className="font-medium">{formatDate(rate.endDate)}</span>
                  </div>
                  <div className="text-sm text-gray-600">
                    €{(rate.nightlyCents / 100).toFixed(2)}/night
                    {rate.minNights && ` · min ${rate.minNights} nights`}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingId(rate.id)}
                    className="px-2 py-1 text-sm text-blue-600 hover:text-blue-800"
                  >
                    Edit
                  </button>
                  <form
                    action={async () => {
                      await deleteRate(rate.id);
                      window.location.reload();
                    }}
                  >
                    <button
                      type="submit"
                      className="px-2 py-1 text-sm text-red-600 hover:text-red-800"
                    >
                      Delete
                    </button>
                  </form>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RateForm({
  apartmentId,
  rate,
  onSubmit,
  onCancel,
  formState,
}: {
  apartmentId: string;
  rate?: Rate;
  onSubmit: (fd: FormData) => Promise<FormState>;
  onCancel: () => void;
  formState?: FormState;
}) {
  return (
    <form
      action={async (fd) => {
        await onSubmit(fd);
      }}
      className="space-y-3 p-4 bg-gray-50 rounded"
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Start date</label>
          <input
            type="date"
            name="startDate"
            defaultValue={rate?.startDate.slice(0, 10)}
            required
            className="w-full px-2 py-1 border rounded text-sm"
          />
          {formState?.fieldErrors?.startDate && (
            <p className="text-red-600 text-xs mt-1">{formState.fieldErrors.startDate[0]}</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">End date</label>
          <input
            type="date"
            name="endDate"
            defaultValue={rate?.endDate.slice(0, 10)}
            required
            className="w-full px-2 py-1 border rounded text-sm"
          />
          {formState?.fieldErrors?.endDate && (
            <p className="text-red-600 text-xs mt-1">{formState.fieldErrors.endDate[0]}</p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Price per night (€)</label>
          <input
            type="number"
            name="nightlyEuros"
            defaultValue={rate ? rate.nightlyCents / 100 : ""}
            step="0.01"
            min="0"
            max="10000"
            required
            className="w-full px-2 py-1 border rounded text-sm"
          />
          {formState?.fieldErrors?.nightlyEuros && (
            <p className="text-red-600 text-xs mt-1">{formState.fieldErrors.nightlyEuros[0]}</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Min nights (optional)</label>
          <input
            type="number"
            name="minNights"
            defaultValue={rate?.minNights ?? ""}
            min="1"
            max="60"
            className="w-full px-2 py-1 border rounded text-sm"
          />
          {formState?.fieldErrors?.minNights && (
            <p className="text-red-600 text-xs mt-1">{formState.fieldErrors.minNights[0]}</p>
          )}
        </div>
      </div>
      {formState?.error && (
        <p className="text-red-600 text-sm">{formState.error}</p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          {rate ? "Update" : "Add"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1 text-sm bg-gray-200 rounded hover:bg-gray-300"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
