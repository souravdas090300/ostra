"use client";

import { useActionState, useState } from "react";
import type { BookingFormState } from "@/app/(app)/bookings/actions";
import type { Overlap } from "@/lib/booking-overlaps";
import { LANGUAGES, getLanguage } from "@/lib/languages";
import { suggestLanguageFromPhone } from "@/lib/phone";
import { formatYmd } from "@/lib/dates";

export type BookingValues = {
  apartmentId: string;
  checkIn: string;
  checkOut: string;
  guestName: string;
  guestPhone: string;
  guestLanguage: string;
  guests: string;
  notes: string;
};

type Props = {
  action: (prev: BookingFormState, fd: FormData) => Promise<BookingFormState>;
  mode: "create" | "edit-direct" | "edit-synced";
  values: BookingValues;
  apartments?: { id: string; name: string }[]; // create only
  defaultGuestLanguageName: string;
  submitLabel: string;
};

export function BookingForm({
  action,
  mode,
  values,
  apartments,
  defaultGuestLanguageName,
  submitLabel,
}: Props) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const v = (k: keyof BookingValues) => state?.submitted?.[k] ?? values[k]; // keep input after a failed submit
  const e = state?.fieldErrors ?? {};
  const [phone, setPhone] = useState(v("guestPhone"));
  const [language, setLanguage] = useState(v("guestLanguage"));
  const suggestion = phone && !language ? suggestLanguageFromPhone(phone) : null;
  const err = (k: string) => e[k]?.map((m) => <p key={m} className="text-sm text-red-600">{m}</p>);

  return (
    <form action={formAction} className="max-w-xl space-y-4">
      {mode === "create" && (
        <label className="block">
          <span className="text-sm font-medium">Apartment</span>
          <select name="apartmentId" defaultValue={v("apartmentId")} className="mt-1 w-full rounded-md border px-3 py-2">
            <option value="">Choose...</option>
            {apartments?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {err("apartmentId")}
        </label>
      )}

      {mode !== "edit-synced" ? (
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium">Check-in</span>
            <input
              type="date"
              name="checkIn"
              defaultValue={v("checkIn")}
              className="mt-1 w-full rounded-md border px-3 py-2"
            />
            {err("checkIn")}
          </label>
          <label className="block">
            <span className="text-sm font-medium">Check-out</span>
            <input
              type="date"
              name="checkOut"
              defaultValue={v("checkOut")}
              className="mt-1 w-full rounded-md border px-3 py-2"
            />
            {err("checkOut")}
          </label>
        </div>
      ) : (
        <p className="rounded bg-gray-50 p-3 text-sm text-gray-600">
          Dates come from the booking platform and cannot be changed here.
        </p>
      )}

      <label className="block">
        <span className="text-sm font-medium">Guest name</span>
        <input name="guestName" defaultValue={v("guestName")} className="mt-1 w-full rounded-md border px-3 py-2" />
        {err("guestName")}
      </label>

      <label id="guest" className="block">
        <span className="text-sm font-medium">Guest WhatsApp number</span>
        <input
          name="guestPhone"
          inputMode="tel"
          autoComplete="off"
          value={phone}
          onChange={(ev) => setPhone(ev.target.value)}
          placeholder="7912 3456 or +49 151 ..."
          className="mt-1 w-full rounded-md border px-3 py-2"
        />
        <span className="text-xs text-gray-500">
          Maltese numbers need no country code. Automatic messages and WhatsApp replies need this number.
        </span>
        {err("guestPhone")}
        {state?.landline && (
          <p className="text-sm text-amber-700">This looks like a landline. WhatsApp usually needs a mobile number.</p>
        )}
      </label>

      <label className="block">
        <span className="text-sm font-medium">Guest language</span>
        <select
          name="guestLanguage"
          value={language}
          onChange={(ev) => setLanguage(ev.target.value)}
          className="mt-1 w-full rounded-md border px-3 py-2"
        >
          <option value="">Not known yet (use {defaultGuestLanguageName})</option>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name} ({l.native})
            </option>
          ))}
        </select>
        {suggestion && (
          <button
            type="button"
            onClick={() => setLanguage(suggestion)}
            className="mt-1 text-sm underline"
          >
            Phone number suggests {getLanguage(suggestion)?.name}. Use it?
          </button>
        )}
        {err("guestLanguage")}
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm font-medium">Number of guests</span>
          <input
            type="number"
            name="guests"
            min={1}
            max={30}
            defaultValue={v("guests")}
            className="mt-1 w-full rounded-md border px-3 py-2"
          />
          {err("guests")}
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-medium">Private notes</span>
        <textarea name="notes" rows={3} defaultValue={v("notes")} className="mt-1 w-full rounded-md border px-3 py-2" />
        {err("notes")}
      </label>

      {state?.overlaps && state.overlaps.length > 0 && <OverlapWarning overlaps={state.overlaps} />}
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-sm text-green-700">Saved.</p>}

      <div className="flex flex-wrap gap-2">
        {state?.overlaps?.length ? (
          <button
            name="confirmOverlap"
            value="1"
            disabled={pending}
            className="rounded-md bg-red-700 px-4 py-2 text-white disabled:opacity-50"
          >
            Save anyway
          </button>
        ) : (
          <button disabled={pending} className="rounded-md bg-black px-4 py-2 text-white disabled:opacity-50">
            {pending ? "Saving..." : submitLabel}
          </button>
        )}
      </div>
    </form>
  );
}

function OverlapWarning({ overlaps }: { overlaps: Overlap[] }) {
  return (
    <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
      <p className="font-medium">These dates overlap:</p>
      <ul className="mt-1 list-disc pl-5">
        {overlaps.map((o) => (
          <li key={o.id}>
            {o.label} ({formatYmd(o.inYmd)} to {formatYmd(o.outYmd)})
          </li>
        ))}
      </ul>
      <p className="mt-2">Check the dates, or save anyway if you know what you are doing.</p>
    </div>
  );
}
