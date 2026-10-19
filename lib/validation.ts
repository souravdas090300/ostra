import { z } from "zod";
import { LANGUAGE_CODES } from "./languages";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h)");

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
  reviewUrl: z.string().url().max(500).optional().or(z.literal("")),
});

export const feedSchema = z.object({
  source: z.enum(["AIRBNB", "BOOKING_COM"]),
  icalUrl: z.string().trim().url().max(2000),
});

export const settingsSchema = z.object({
  hostLanguage: z.enum(LANGUAGE_CODES),
  defaultGuestLanguage: z.enum(LANGUAGE_CODES),
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
