"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/(app)/apartments/actions";
import { INFO_TEMPLATE, PUBLIC_INFO_TEMPLATE } from "@/lib/info-template";

type Values = {
  name: string; address: string; checkInTime: string; checkOutTime: string;
  maxGuests: number; bedrooms: number; minNights: number;
  baseNightlyEuros: number; cleaningFeeEuros: number;
  info: string; publicInfo: string;
};

export const EMPTY_APARTMENT: Values = {
  name: "", address: "", checkInTime: "15:00", checkOutTime: "11:00",
  maxGuests: 2, bedrooms: 1, minNights: 1, baseNightlyEuros: 0, cleaningFeeEuros: 0,
  info: INFO_TEMPLATE, publicInfo: PUBLIC_INFO_TEMPLATE,
};

function Field(props: {
  label: string; name: string; defaultValue: string | number; type?: string;
  step?: string; errors?: string[]; hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{props.label}</span>
      <input
        name={props.name} type={props.type ?? "text"} step={props.step}
        defaultValue={props.defaultValue}
        className="mt-1 w-full rounded-md border px-3 py-2"
      />
      {props.hint && <span className="text-xs text-gray-500">{props.hint}</span>}
      {props.errors?.map((e) => <p key={e} className="text-sm text-red-600">{e}</p>)}
    </label>
  );
}

export function ApartmentForm({
  action, values, submitLabel,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  values: Values; submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const e = state?.fieldErrors ?? {};
  const v = (k: keyof Values) => state?.submitted?.[k] ?? values[k];
  return (
    <form action={formAction} className="space-y-4 max-w-2xl">
      <Field label="Name" name="name" defaultValue={v("name")} errors={e.name} />
      <Field label="Address (private, shared only with booked guests)" name="address" defaultValue={v("address")} errors={e.address} />
      <div className="grid grid-cols-2 gap-4">
        <Field label="Check-in time" name="checkInTime" defaultValue={v("checkInTime")} errors={e.checkInTime} hint="HH:MM" />
        <Field label="Check-out time" name="checkOutTime" defaultValue={v("checkOutTime")} errors={e.checkOutTime} hint="HH:MM" />
        <Field label="Max guests" name="maxGuests" type="number" defaultValue={v("maxGuests")} errors={e.maxGuests} />
        <Field label="Bedrooms" name="bedrooms" type="number" defaultValue={v("bedrooms")} errors={e.bedrooms} />
        <Field label="Minimum nights" name="minNights" type="number" defaultValue={v("minNights")} errors={e.minNights} />
        <Field label="Base price per night (EUR)" name="baseNightlyEuros" type="number" step="0.01" defaultValue={v("baseNightlyEuros")} errors={e.baseNightlyEuros} />
        <Field label="Cleaning fee (EUR)" name="cleaningFeeEuros" type="number" step="0.01" defaultValue={v("cleaningFeeEuros")} errors={e.cleaningFeeEuros} />
      </div>

      <label className="block">
        <span className="text-sm font-medium">Guest information (private)</span>
        <span className="block text-xs text-gray-500">
          Write in your own language. The assistant answers booked guests from this, in the guest&apos;s language.
        </span>
        <textarea name="info" rows={18} defaultValue={v("info")}
          className="mt-1 w-full rounded-md border px-3 py-2 font-mono text-sm" />
        {e.info?.map((m) => <p key={m} className="text-sm text-red-600">{m}</p>)}
      </label>

      <label className="block">
        <span className="text-sm font-medium">Public information (for enquiries)</span>
        <span className="block text-xs text-gray-500">
          Safe to share with anyone. No door codes, passwords or exact address.
        </span>
        <textarea name="publicInfo" rows={10} defaultValue={v("publicInfo")}
          className="mt-1 w-full rounded-md border px-3 py-2 font-mono text-sm" />
        {e.publicInfo?.map((m) => <p key={m} className="text-sm text-red-600">{m}</p>)}
      </label>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-sm text-green-700">Saved.</p>}
      <button disabled={pending} className="rounded-md bg-black px-4 py-2 text-white disabled:opacity-50">
        {pending ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}
