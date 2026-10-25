import { z } from "zod";
import { LANGUAGE_CODES } from "./languages";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h)");

export const MAX_TEXT = 1500;

export type SimpleState = {
  error?: string;
  ok?: boolean;
};

export type PreviewState = {
  translation: string;
  backTranslation: string;
  warnings: string[];
  error?: string;
};

export type InboxPreviewState = {
  ok?: boolean;
  error?: string;
  sameLanguage?: boolean;
  guestLanguage?: string;
  translation?: string;
  backTranslation?: string;
  warnings?: string[];
};

export const apartmentSchema = z.object({
  name: z.string().trim().min(1, "Required").max(80),
  address: z.string().trim().min(1, "Required").max(200),
  checkInTime: time,
  checkOutTime: time,
  maxGuests: z.coerce.number().int().min(1).max(30),
  bedrooms: z.coerce.number().int().min(0).max(20),
  minNights: z.coerce.number().int().min(1).max(60),
  baseNightlyEuros: z.coerce.number().min(0).max(10000),
  cleaningFeeEuros: z.coerce.number().min(0).max(10000),
  info: z.string().max(20000),
  publicInfo: z.string().max(10000),
  reviewUrl: z.string().url({ message: "Invalid URL" }).max(500).optional().or(z.literal("")),
});

export const feedSchema = z.object({
  source: z.enum(["AIRBNB", "BOOKING_COM"]),
  icalUrl: z.string().trim().url({ message: "Invalid URL" }).max(2000),
});

export const settingsSchema = z.object({
  hostLanguage: z.enum(LANGUAGE_CODES),
  defaultGuestLanguage: z.enum(LANGUAGE_CODES),
  enquiriesEnabled: z.coerce.boolean().optional(),
});

/** First line of SSRF defence. Phase 3 must ALSO resolve DNS and block private IPs at fetch time. */
export function isSafeFeedUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== "443") return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":")) return false; // IP literals
  return true;
}

export const toCents = (euros: number) => Math.round(euros * 100);

/** Convert FormData to a simple string-keyed object, filtering out non-string values. */
export const echo = (fd: FormData): Record<string, string> =>
  Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;

/** Validate a date range and return field errors if invalid. */
export function validateDateRange(
  startDateStr: string | null,
  endDateStr: string | null
): { fieldErrors?: Record<string, string[]> } | undefined {
  if (!startDateStr || !endDateStr) {
    return { fieldErrors: { startDate: ["Required"], endDate: ["Required"] } };
  }
  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return { fieldErrors: { startDate: ["Invalid date"], endDate: ["Invalid date"] } };
  }
  if (endDate < startDate) {
    return { fieldErrors: { endDate: ["End date cannot be before start date"] } };
  }
  return undefined;
}

/** Validate rate data and return field errors if invalid. */
export function validateRateData(
  startDateStr: string | null,
  endDateStr: string | null,
  nightlyEuros: number,
  minNightsStr: string | null
): { fieldErrors?: Record<string, string[]> } | undefined {
  const dateErrors = validateDateRange(startDateStr, endDateStr);
  if (dateErrors) return dateErrors;

  if (nightlyEuros < 0 || nightlyEuros > 10000) {
    return { fieldErrors: { nightlyEuros: ["Price must be between 0 and 10000 euros"] } };
  }

  const minNights = minNightsStr ? Number(minNightsStr) : null;
  if (minNights !== null && (minNights < 1 || minNights > 60)) {
    return { fieldErrors: { minNights: ["Minimum nights must be between 1 and 60"] } };
  }

  return undefined;
}

/** Helper to save original body if it differs from the translated body. */
export function saveOriginalBody(original: string, body: string): string | null {
  const trimmedOriginal = original.trim();
  return trimmedOriginal && trimmedOriginal !== body ? trimmedOriginal.slice(0, MAX_TEXT) : null;
}
