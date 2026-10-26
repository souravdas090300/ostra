# Ostra Phase 5: Direct bookings and guest contact

> **For Devin:** read `OSTRA_PLAN.md` (Phase 5) and this file. This file **replaces** Phase 5 in the plan where they differ. Complete **Phase 5 only**, in one PR, and meet every acceptance criterion in section 10. Assumes Phases 1-4 are merged (`lib/dates.ts`, `lib/time.ts`, `lib/conflicts.ts`, `lib/calendar-data.ts` with `loadStays`, `lib/languages.ts`, `lib/schedule.ts` with the `rescheduleBookings` stub).

## 0. Decisions that shape the code

1. **Guest phone numbers are the key for WhatsApp.** Phase 7 matches inbound messages to bookings by exact phone number, so every number is stored in **E.164** (`+35679123456`). Invalid numbers are rejected with a clear message, never stored.
2. **What the host can change depends on the booking type:**

| Booking | Dates | Guest name, phone, language, guests, notes | Cancel |
|---|---|---|---|
| `DIRECT` | editable | editable | yes (and restore) |
| Synced (Airbnb, Booking.com) | **read-only** (the platform is the source of truth; Phase 3 sync would overwrite them) | editable (sync never overwrites these) | no, cancel on the platform |
| Block (`isBlock`) | read-only | not editable | no |
| `CANCELLED` | read-only | read-only | direct bookings can be restored |

   Enforce this **on the server**: for synced bookings the action must not even read date fields from the form, so a crafted request cannot change them.
3. **Overlaps warn, they do not forbid.** A direct booking that overlaps another booking or a block shows the clash and requires an explicit "Save anyway". Back-to-back stays (same-day turnover) are not overlaps. Cancelled bookings never count.
4. **Direct bookings do not block Airbnb or Booking.com yet** (that arrives with the Phase 11 calendar export). Until then, every direct booking shows a notice telling the host to block the dates on both platforms. A constant `ICAL_EXPORT_ENABLED = false` in `lib/features.ts` controls this; Phase 11 flips it.
5. **The language is a hint, never silently set.** A phone prefix suggests a language ("+49 suggests German") but the host must click to accept it. If the language stays empty, later phases use `booking.guestLanguage ?? owner.defaultGuestLanguage`.
6. **Nothing is hard-deleted.** Cancelling keeps history. (Deletion and the 90-day retention job belong to Phase 9.)
7. Every query is owner-scoped (`apartment: { ownerId }`). Phone numbers and notes are personal data: never log them.

## 1. Dependencies, schema, config

```bash
npm i libphonenumber-js
```

Migration `phase5_bookings`:
```prisma
model Booking {
  // add:
  guests         Int?                       // number of guests, if known
  notes          String?                    // private notes for the host
  messagesPaused Boolean @default(false)    // host paused automatic messages (used in Phase 6)
}
```

`src/lib/features.ts`
```ts
/** Phase 11 sets this to true when the outbound iCal export exists. */
export const ICAL_EXPORT_ENABLED = false;
```

## 2. `src/lib/phone.ts`

Use the `libphonenumber-js/mobile` entry point (it knows mobile vs landline) so the form can warn about landlines.

```ts
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/mobile";

export type PhoneResult =
  | { ok: true; e164: string; isLandline: boolean; country?: string }
  | { ok: false };

/** Accepts "7912 3456" (Malta by default), "+49 151 ...", "0049 151 ...", with spaces, dots, dashes, brackets. */
export function normalisePhone(raw: string, defaultCountry: CountryCode = "MT"): PhoneResult {
  let s = raw.trim().replace(/[\s().-]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  const p = parsePhoneNumberFromString(s, defaultCountry);
  if (!p || !p.isValid()) return { ok: false };
  return { ok: true, e164: p.number, isLandline: p.getType() === "FIXED_LINE", country: p.country };
}

export function formatPhone(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}

// One dominant language per country only. Multilingual countries (BE, CH, LU, MT, CY, LB, ...) are
// deliberately left out: a wrong guess is worse than no suggestion.
const COUNTRY_LANGUAGE: Record<string, string> = {
  DE: "de", AT: "de", IT: "it", FR: "fr", ES: "es", PT: "pt", NL: "nl", PL: "pl", CZ: "cs", SK: "sk",
  HU: "hu", RO: "ro", BG: "bg", GR: "el", HR: "hr", SI: "sl", RS: "sr", BA: "bs", MK: "mk", AL: "sq",
  UA: "uk", RU: "ru", BY: "be", SE: "sv", NO: "nb", DK: "da", FI: "fi", EE: "et", LV: "lv", LT: "lt",
  IS: "is", GB: "en", IE: "en", TR: "tr", GE: "ka", AM: "hy",
  SA: "ar", AE: "ar", EG: "ar", MA: "ar", DZ: "ar", TN: "ar", JO: "ar", QA: "ar", KW: "ar", OM: "ar",
  BH: "ar", LY: "ar", IQ: "ar", SY: "ar", YE: "ar",
};

/** Hint only. Returns a language code from LANGUAGES, or null. */
export function suggestLanguageFromPhone(raw: string): string | null {
  const r = normalisePhone(raw);
  return r.ok && r.country ? COUNTRY_LANGUAGE[r.country] ?? null : null;
}
```

## 3. `src/lib/booking-validation.ts`

```ts
import { z } from "zod";
import { LANGUAGE_CODES } from "./languages";
import { addDays, diffDays, isValidYmd } from "./dates";
import { normalisePhone } from "./phone";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const contactSchema = z.object({
  guestName: z.preprocess(blank, z.string().trim().max(100).optional()),
  guestPhone: z.preprocess(blank, z.string().trim().max(40).optional()),
  guestLanguage: z.preprocess(blank, z.enum(LANGUAGE_CODES).optional()),
  guests: z.preprocess(blank, z.coerce.number().int().min(1).max(30).optional()),
  notes: z.preprocess(blank, z.string().trim().max(1000).optional()),
});

export type Contact = {
  guestName?: string; guestPhone?: string; guestLanguage?: string; guests?: number; notes?: string;
};

export function parseContact(fd: FormData): {
  data?: Contact; fieldErrors: Record<string, string[]>; landline: boolean;
} {
  const r = contactSchema.safeParse(Object.fromEntries(fd));
  const fieldErrors: Record<string, string[]> = r.success
    ? {} : (r.error.flatten().fieldErrors as Record<string, string[]>);
  let phone: string | undefined;
  let landline = false;
  if (r.success && r.data.guestPhone) {
    const p = normalisePhone(r.data.guestPhone);
    if (p.ok) { phone = p.e164; landline = p.isLandline; }
    else fieldErrors.guestPhone = ["Enter a valid phone number. Include the country code if it is not Maltese, e.g. +49 151 ..."];
  }
  return { fieldErrors, landline, data: r.success ? { ...r.data, guestPhone: phone } : undefined };
}

export function parseStayDates(fd: FormData, today: string):
  | { ok: true; inYmd: string; outYmd: string }
  | { ok: false; fieldErrors: Record<string, string[]> } {
  const inYmd = String(fd.get("checkIn") ?? "");
  const outYmd = String(fd.get("checkOut") ?? "");
  const e: Record<string, string[]> = {};
  if (!isValidYmd(inYmd)) e.checkIn = ["Pick a check-in date."];
  if (!isValidYmd(outYmd)) e.checkOut = ["Pick a check-out date."];
  if (!e.checkIn && !e.checkOut) {
    if (outYmd <= inYmd) e.checkOut = ["Check-out must be after check-in."];
    else if (diffDays(inYmd, outYmd) > 365) e.checkOut = ["Maximum stay is 365 nights."];
    else if (inYmd < addDays(today, -30)) e.checkIn = ["Check-in is too far in the past."];
    else if (inYmd > addDays(today, 730)) e.checkIn = ["Check-in is too far in the future."];
  }
  return Object.keys(e).length ? { ok: false, fieldErrors: e } : { ok: true, inYmd, outYmd };
}
```

## 4. `src/lib/booking-overlaps.ts`

```ts
import { loadStays } from "./calendar-data";
import { SOURCE_LABEL } from "./calendar-view";
import type { SourceName } from "./conflicts";

export type Overlap = {
  id: string; kind: "BOOKING" | "BLOCK"; source: SourceName; label: string; inYmd: string; outYmd: string;
};

/** Non-cancelled stays or blocks in this apartment whose nights overlap [inYmd, outYmd). Back-to-back is not an overlap. */
export async function findOverlaps(
  ownerId: string, apartmentId: string, inYmd: string, outYmd: string, excludeId?: string,
): Promise<Overlap[]> {
  const stays = await loadStays(ownerId, inYmd, outYmd); // already owner-scoped, hides cancelled
  return stays
    .filter((s) => s.apartmentId === apartmentId && s.id !== excludeId && s.inYmd < outYmd && s.outYmd > inYmd)
    .map((s) => ({
      id: s.id, kind: s.isBlock ? "BLOCK" : "BOOKING", source: s.source,
      label: s.isBlock ? "Blocked dates" : s.guestName ?? SOURCE_LABEL[s.source],
      inYmd: s.inYmd, outYmd: s.outYmd,
    }));
}
```
Two simultaneous saves can both pass this check. That is acceptable for one host; do not add locking in v1.

## 5. Server actions: `src/app/(app)/bookings/actions.ts`

```ts
"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { maltaLocalToUtc, maltaYmd } from "@/lib/time";
import { todayMalta } from "@/lib/dates";
import { parseContact, parseStayDates } from "@/lib/booking-validation";
import { findOverlaps, type Overlap } from "@/lib/booking-overlaps";
import { rescheduleBookings } from "@/lib/schedule";

export type BookingFormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string[] | undefined>;
      overlaps?: Overlap[];
      landline?: boolean;
      ok?: boolean;
      submitted?: Record<string, string>; // echo, because React resets uncontrolled inputs after an action
    }
  | undefined;

const echo = (fd: FormData): Record<string, string> =>
  Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;

const nullify = <T,>(v: T | undefined) => (v === undefined ? null : v);

export async function createBooking(_p: BookingFormState, fd: FormData): Promise<BookingFormState> {
  const owner = await requireOwner();
  const submitted = echo(fd);

  const apartment = await prisma.apartment.findFirst({
    where: { id: String(fd.get("apartmentId") ?? ""), ownerId: owner.id },
  });
  if (!apartment) return { fieldErrors: { apartmentId: ["Choose an apartment."] }, submitted };

  const contact = parseContact(fd);
  const dates = parseStayDates(fd, todayMalta());
  const fieldErrors = { ...contact.fieldErrors, ...(dates.ok ? {} : dates.fieldErrors) };
  if (!contact.data || !dates.ok || Object.keys(fieldErrors).length) return { fieldErrors, submitted };

  const overlaps = await findOverlaps(owner.id, apartment.id, dates.inYmd, dates.outYmd);
  if (overlaps.length && fd.get("confirmOverlap") !== "1") return { overlaps, submitted, landline: contact.landline };

  const booking = await prisma.booking.create({
    data: {
      apartmentId: apartment.id,
      source: "DIRECT",
      status: "CONFIRMED",
      isBlock: false,
      checkIn: maltaLocalToUtc(dates.inYmd, apartment.checkInTime),
      checkOut: maltaLocalToUtc(dates.outYmd, apartment.checkOutTime),
      guestName: nullify(contact.data.guestName),
      guestPhone: nullify(contact.data.guestPhone),
      guestLanguage: nullify(contact.data.guestLanguage),
      guests: nullify(contact.data.guests),
      notes: nullify(contact.data.notes),
    },
  });
  await rescheduleBookings([booking.id]);
  revalidatePath("/calendar");
  redirect(`/bookings/${booking.id}?created=1`);
}

export async function updateBooking(id: string, _p: BookingFormState, fd: FormData): Promise<BookingFormState> {
  const owner = await requireOwner();
  const submitted = echo(fd);
  const b = await prisma.booking.findFirst({
    where: { id, apartment: { ownerId: owner.id } }, // ownership enforced in the query
    include: { apartment: true },
  });
  if (!b) notFound();
  if (b.isBlock) return { error: "Blocked dates cannot be edited.", submitted };
  if (b.status === "CANCELLED") return { error: "This booking is cancelled.", submitted };

  const contact = parseContact(fd);
  if (!contact.data || Object.keys(contact.fieldErrors).length) return { fieldErrors: contact.fieldErrors, submitted };

  const data: Record<string, unknown> = {
    guestName: nullify(contact.data.guestName),
    guestPhone: nullify(contact.data.guestPhone),
    guestLanguage: nullify(contact.data.guestLanguage),
    guests: nullify(contact.data.guests),
    notes: nullify(contact.data.notes),
  };
  let datesChanged = false;

  if (b.source === "DIRECT") {
    // Only direct bookings read date fields. Synced bookings ignore them completely.
    const dates = parseStayDates(fd, todayMalta());
    if (!dates.ok) return { fieldErrors: dates.fieldErrors, submitted };
    const overlaps = await findOverlaps(owner.id, b.apartmentId, dates.inYmd, dates.outYmd, b.id);
    if (overlaps.length && fd.get("confirmOverlap") !== "1") return { overlaps, submitted, landline: contact.landline };
    const checkIn = maltaLocalToUtc(dates.inYmd, b.apartment.checkInTime);
    const checkOut = maltaLocalToUtc(dates.outYmd, b.apartment.checkOutTime);
    datesChanged = checkIn.getTime() !== b.checkIn.getTime() || checkOut.getTime() !== b.checkOut.getTime();
    data.checkIn = checkIn;
    data.checkOut = checkOut;
  }

  await prisma.booking.update({ where: { id: b.id }, data });
  const reschedule =
    datesChanged ||
    (contact.data.guestPhone ?? null) !== b.guestPhone ||
    (contact.data.guestLanguage ?? null) !== b.guestLanguage;
  if (reschedule) await rescheduleBookings([b.id]);

  revalidatePath(`/bookings/${b.id}`);
  revalidatePath("/calendar");
  return { ok: true, landline: contact.landline };
}

export async function cancelDirectBooking(id: string, _p: BookingFormState): Promise<BookingFormState> {
  const owner = await requireOwner();
  const b = await prisma.booking.findFirst({ where: { id, apartment: { ownerId: owner.id } } });
  if (!b) notFound();
  if (b.source !== "DIRECT") return { error: "Cancel this booking on Airbnb or Booking.com. Ostra will update within the hour." };
  if (b.status === "CANCELLED") return { ok: true };
  await prisma.booking.update({ where: { id: b.id }, data: { status: "CANCELLED" } });
  await rescheduleBookings([b.id]); // Phase 6 removes unsent scheduled messages
  revalidatePath("/calendar");
  redirect("/calendar");
}

export async function restoreDirectBooking(id: string, _p: BookingFormState, fd: FormData): Promise<BookingFormState> {
  const owner = await requireOwner();
  const b = await prisma.booking.findFirst({ where: { id, apartment: { ownerId: owner.id } } });
  if (!b) notFound();
  if (b.source !== "DIRECT" || b.status !== "CANCELLED") return { error: "Only cancelled direct bookings can be restored." };
  const overlaps = await findOverlaps(owner.id, b.apartmentId, maltaYmd(b.checkIn), maltaYmd(b.checkOut), b.id);
  if (overlaps.length && fd.get("confirmOverlap") !== "1") return { overlaps };
  await prisma.booking.update({ where: { id: b.id }, data: { status: "CONFIRMED" } });
  await rescheduleBookings([b.id]);
  revalidatePath(`/bookings/${b.id}`);
  revalidatePath("/calendar");
  return { ok: true };
}

export async function setMessagesPaused(id: string, paused: boolean): Promise<void> {
  const owner = await requireOwner();
  const { count } = await prisma.booking.updateMany({
    where: { id, isBlock: false, apartment: { ownerId: owner.id } },
    data: { messagesPaused: paused },
  });
  if (count === 0) notFound();
  await rescheduleBookings([id]);
  revalidatePath(`/bookings/${id}`);
}
```

## 6. UI

### `src/components/BookingForm.tsx` (client)

One form for create, edit-direct and edit-synced.

```tsx
"use client";

import { useActionState, useState } from "react";
import type { BookingFormState } from "@/app/(app)/bookings/actions";
import type { Overlap } from "@/lib/booking-overlaps";
import { LANGUAGES, getLanguage } from "@/lib/languages";
import { suggestLanguageFromPhone } from "@/lib/phone";
import { formatYmd } from "@/lib/dates";

export type BookingValues = {
  apartmentId: string; checkIn: string; checkOut: string; guestName: string; guestPhone: string;
  guestLanguage: string; guests: string; notes: string;
};

type Props = {
  action: (prev: BookingFormState, fd: FormData) => Promise<BookingFormState>;
  mode: "create" | "edit-direct" | "edit-synced";
  values: BookingValues;
  apartments?: { id: string; name: string }[];   // create only
  defaultGuestLanguageName: string;
  submitLabel: string;
};

export function BookingForm({ action, mode, values, apartments, defaultGuestLanguageName, submitLabel }: Props) {
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
            {apartments?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {err("apartmentId")}
        </label>
      )}

      {mode !== "edit-synced" ? (
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium">Check-in</span>
            <input type="date" name="checkIn" defaultValue={v("checkIn")} className="mt-1 w-full rounded-md border px-3 py-2" />
            {err("checkIn")}
          </label>
          <label className="block">
            <span className="text-sm font-medium">Check-out</span>
            <input type="date" name="checkOut" defaultValue={v("checkOut")} className="mt-1 w-full rounded-md border px-3 py-2" />
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
          name="guestPhone" inputMode="tel" autoComplete="off" value={phone}
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
        <select name="guestLanguage" value={language} onChange={(ev) => setLanguage(ev.target.value)}
          className="mt-1 w-full rounded-md border px-3 py-2">
          <option value="">Not known yet (use {defaultGuestLanguageName})</option>
          {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name} ({l.native})</option>)}
        </select>
        {suggestion && (
          <button type="button" onClick={() => setLanguage(suggestion)} className="mt-1 text-sm underline">
            Phone number suggests {getLanguage(suggestion)?.name}. Use it?
          </button>
        )}
        {err("guestLanguage")}
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm font-medium">Number of guests</span>
          <input type="number" name="guests" min={1} max={30} defaultValue={v("guests")} className="mt-1 w-full rounded-md border px-3 py-2" />
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
          <button name="confirmOverlap" value="1" disabled={pending}
            className="rounded-md bg-red-700 px-4 py-2 text-white disabled:opacity-50">
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
          <li key={o.id}>{o.label} ({formatYmd(o.inYmd)} to {formatYmd(o.outYmd)})</li>
        ))}
      </ul>
      <p className="mt-2">Check the dates, or save anyway if you know what you are doing.</p>
    </div>
  );
}
```

### `src/app/(app)/bookings/new/page.tsx`
Server component. `requireOwner()`, load the owner's apartments (`id`, `name`, ordered by name). If there are none, link to `/apartments/new`. Read optional `searchParams` `apartmentId`, `checkIn`, `checkOut` (validate: `apartmentId` must be one of the owner's apartments, dates must pass `isValidYmd`; otherwise ignore) and pass them as initial `values`. Render `<BookingForm mode="create" action={createBooking} submitLabel="Create booking" defaultGuestLanguageName={getLanguage(owner.defaultGuestLanguage)?.name ?? "English"} .../>`. Back link to `/calendar`.

### `src/components/PlatformBlockNotice.tsx`
```tsx
import { ICAL_EXPORT_ENABLED } from "@/lib/features";
import { formatYmd } from "@/lib/dates";

export function PlatformBlockNotice(p: { apartmentName: string; inYmd: string; outYmd: string }) {
  if (ICAL_EXPORT_ENABLED) return null;
  return (
    <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-medium">Block these dates on Airbnb and Booking.com</p>
      <p className="mt-1">
        Ostra cannot block other platforms yet. In both apps, close {p.apartmentName} from {formatYmd(p.inYmd)} to{" "}
        {formatYmd(p.outYmd)} (guest leaves on {formatYmd(p.outYmd)}, so the last night to close is the night before),
        so nobody else books it.
      </p>
    </div>
  );
}
```

### `src/app/(app)/bookings/[id]/page.tsx`
Server component (`params` and `searchParams` are Promises in Next 15):
1. `requireOwner()`, then load the booking `where: { id, apartment: { ownerId: owner.id } }` with `apartment`, `messages` (`orderBy createdAt asc`, `take 100`) and `scheduled` (`orderBy sendAt asc`). `notFound()` if missing.
2. Header: label (`guestName` or source label), source badge with the A/B/D letter, status badge (**Cancelled** in grey). For `isBlock`: a short read-only page ("Dates closed on the platform") with no forms.
3. If `?created=1` and the booking is `DIRECT`: green "Booking saved" banner.
4. **Banners** (shown when relevant):
   - Red: `findOverlaps(owner.id, apartmentId, inYmd, outYmd, id)` returned a `BOOKING` overlap, "This stay overlaps {label} ({dates})".
   - Amber: `guests > apartment.maxGuests`, "More guests than the apartment's maximum ({max})".
   - Amber: no `guestPhone`, "Add a WhatsApp number to switch on automatic messages".
   - `PlatformBlockNotice` for `DIRECT` bookings that are confirmed and not yet checked out.
5. **Stay** section: apartment name linked to `/apartments/<id>`, dates with weekday, nights, times (`apartment.checkInTime` and `checkOutTime`), source.
6. **Guest** section: `<BookingForm>` with `mode` `"edit-direct"` for `DIRECT`, `"edit-synced"` otherwise, bound with `updateBooking.bind(null, b.id)`, initial values from the booking (`checkIn: maltaYmd(b.checkIn)` etc., phone shown in E.164 as stored). Hide the form for cancelled bookings and show the details read-only.
7. **Automatic messages** section: a form button using `setMessagesPaused.bind(null, b.id, !b.messagesPaused)` labelled "Pause automatic messages" / "Resume automatic messages", plus the list of `scheduled` rows (type, send time in Malta, sent or not). Until Phase 6 this list is empty: show "Scheduled messages will appear here."
8. **Message history** section: `messages` as a simple conversation list, each body rendered with `dir="auto"` (Arabic and mixed text). Empty state "No messages yet."
9. **Cancel booking** (client component `BookingActions`, DIRECT and confirmed only): a button with `window.confirm("Cancel this booking? Guests keep their history in Ostra, but no more automatic messages will be sent.")`, using `useActionState(cancelDirectBooking.bind(null, b.id), undefined)`. For cancelled direct bookings show **Restore booking** (uses `restoreDirectBooking`, shows the overlap list and a "Restore anyway" submit with `confirmOverlap=1`). For synced bookings show: "To cancel, use Airbnb or Booking.com. Ostra updates within the hour."

## 7. Changes to Phase 4 and Phase 2 code

**Phase 4, calendar page:** add an **Add booking** button (link to `/bookings/new`) beside the page title.

**Phase 4, `Timeline.tsx` booking sheet:** for non-block bookings add `<Link href={`/bookings/${selected.id}`}>Open booking</Link>` (import `next/link`). Blocks get no link.

**Phase 4, `AttentionPanel.tsx`:** the "missing phone number" items link to `/bookings/<id>#guest` instead of the calendar. Double-booking items also get a second link "Open" for each of the two bookings.

**Phase 2 forms (bug fix):** React 19 resets uncontrolled inputs after a form action completes, so a validation error wipes what the host typed. Apply the same "echo" pattern used here: have `updateApartment`, `createApartment`, `addFeed` and `updateSettings` return `submitted` (the string entries of the `FormData`) and make `ApartmentForm` and `FeedManager` use `state?.submitted?.[name] ?? initialValue` for `defaultValue`. Add a test that a failed apartment save keeps the typed values.

## 8. Tests

**Unit tests (no database)**
- `normalisePhone`: `"7912 3456"` gives `+35679123456`; `"+356 7912-3456"`, `"00356 7912 3456"` and `"(+356) 7912 3456"` give the same; numbers built with `getExampleNumber` from `libphonenumber-js/mobile` for `DE`, `IT`, `GB`, `SA` and `PL` are accepted and normalised; `"12345"`, `"abc"`, `"+999 123"` and `""` fail (`""` is handled earlier as "no phone"); a Maltese landline example number returns `isLandline: true`.
- `suggestLanguageFromPhone`: `+49...` gives `de`, `+39...` `it`, `+966...` `ar`, `+44...` `en`; `+32...` (Belgium), `+41...` (Switzerland), `+356...` (Malta) and invalid numbers give `null`; every language the map can return exists in `LANGUAGES`.
- `parseContact`: blank fields become undefined; invalid phone gives `fieldErrors.guestPhone` and `data` is returned without a phone; bad language code rejected; `guests` 0 and 31 rejected; name over 100 characters rejected.
- `parseStayDates`: check-out equal to or before check-in rejected; 366 nights rejected; check-in 31 days in the past rejected, 30 days accepted; more than 730 days ahead rejected; `2026-02-30` rejected.

**Database tests (`tests/bookings.test.ts`, test database; mock `@/lib/auth`, `next/cache`, `next/navigation`; spy on `rescheduleBookings`)**
1. `createBooking` stores a `DIRECT` `CONFIRMED` booking with the apartment's check-in/out times converted from Malta time (including a summer and a winter date), phone in E.164, `externalUid` null.
2. Overlap with an existing booking returns `overlaps` and creates nothing; the same submit with `confirmOverlap=1` creates it.
3. A stay that starts the day another ends (same-day turnover) is **not** an overlap.
4. Overlap with a **block** is reported with `kind: "BLOCK"`.
5. A cancelled booking in the same dates is **not** an overlap.
6. Another owner's `apartmentId` creates nothing and returns a field error.
7. Another owner's booking: `updateBooking`, `cancelDirectBooking`, `restoreDirectBooking` and `setMessagesPaused` all fail with `notFound` and change nothing.
8. Synced booking: `updateBooking` changes name, phone, language, guests and notes, but a request that also contains `checkIn` and `checkOut` fields leaves the dates unchanged; `cancelDirectBooking` is refused and the status is unchanged.
9. Block: `updateBooking` returns the "cannot be edited" error; `setMessagesPaused` fails.
10. Direct booking date edit: dates change, the booking does not conflict with itself, and `rescheduleBookings` is called once; editing only the notes does **not** call it; changing the phone or language does.
11. Invalid phone: not saved, `fieldErrors.guestPhone` returned, existing data unchanged. Clearing the phone field sets it to null.
12. `cancelDirectBooking` sets `CANCELLED`, the booking disappears from `loadStays`, `rescheduleBookings` is called; `restoreDirectBooking` is refused with overlaps (then allowed with `confirmOverlap=1`) and works without them.
13. Phase 3 interaction: after the host edits phone and language on a synced booking, running the sync again keeps them (reuse the Phase 3 mock fetch).

**Manual check (390 px wide phone)**
- Create a direct booking for the seeded apartment, with a German phone number: the form suggests German; accepting it saves; the booking appears on the calendar as a green **D** bar; the detail page shows the "Block these dates" notice.
- Try overlapping dates: the red list appears, the typed values are still in the fields, and "Save anyway" works.
- On a synced booking the dates are read-only, and on a block there are no forms.
- Arabic text pasted as the guest name or notes displays correctly.

## 9. What is deliberately not in this phase
- Sending or scheduling messages (Phase 6), the AI (Phases 7 and 9), and the iCal export that blocks other platforms (Phase 11).
- Prices, payments and invoices.
- Per-booking custom check-in times, and deleting bookings (Phase 9 handles retention and deletion).

## 10. Acceptance criteria
- The host can create, edit, cancel and restore direct bookings, and edit guest details on synced bookings, on a phone.
- Phone numbers are normalised to E.164 and invalid ones are rejected with a helpful message; landlines get a warning; the language is only suggested, never set silently.
- Dates of synced bookings, blocks and cancelled bookings cannot be changed, even by a crafted request.
- Overlaps (with bookings or blocks) are shown and need an explicit confirmation; back-to-back stays and cancelled bookings never count.
- Every direct booking shows the "block these dates on the other platforms" notice until `ICAL_EXPORT_ENABLED` is true.
- Typed values survive a validation error or an overlap warning (Phase 2 forms fixed too).
- Everything is owner-scoped and tested; no phone number or note appears in any log.
- `npm run lint`, `typecheck`, `test`, `build` pass; the migration applies on a fresh database.
