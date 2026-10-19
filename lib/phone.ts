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
