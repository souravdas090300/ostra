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
  guestName?: string;
  guestPhone?: string;
  guestLanguage?: string;
  guests?: number;
  notes?: string;
};

export function parseContact(fd: FormData): {
  data?: Contact;
  fieldErrors: Record<string, string[]>;
  landline: boolean;
} {
  const r = contactSchema.safeParse(Object.fromEntries(fd));
  const fieldErrors: Record<string, string[]> = r.success
    ? {}
    : (r.error.flatten().fieldErrors as Record<string, string[]>);
  let phone: string | undefined;
  let landline = false;
  if (r.success && r.data.guestPhone) {
    const p = normalisePhone(r.data.guestPhone);
    if (p.ok) {
      phone = p.e164;
      landline = p.isLandline;
    } else {
      fieldErrors.guestPhone = [
        "Enter a valid phone number. Include the country code if it is not Maltese, e.g. +49 151 ...",
      ];
    }
  }
  return { fieldErrors, landline, data: r.success ? { ...r.data, guestPhone: phone } : undefined };
}

export function parseStayDates(
  fd: FormData,
  today: string
):
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
