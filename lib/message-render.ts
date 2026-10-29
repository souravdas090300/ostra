import { maltaYmd } from "./time";
import { fillTemplate } from "./templates";

const clean = (s: string, max = 60) => s.replace(/\s+/g, " ").trim().slice(0, max);

export function formatDateLocal(ymd: string, lang: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  const opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" };
  try {
    return new Intl.DateTimeFormat(lang, opts).format(d);
  } catch {
    return new Intl.DateTimeFormat("en", opts).format(d);
  }
}

export function buildValues(
  b: { guestName: string | null; checkIn: Date; checkOut: Date },
  apt: { name: string; checkInTime: string; checkOutTime: string; reviewUrl: string | null },
  lang: string,
): Record<string, string> {
  const first = b.guestName?.trim().split(/\s+/)[0];
  return {
    guestName: clean(first || "👋", 30), // language-neutral fallback when the name is unknown
    apartmentName: clean(apt.name),
    checkInDate: formatDateLocal(maltaYmd(b.checkIn), lang),
    checkInTime: apt.checkInTime,
    checkOutTime: apt.checkOutTime,
    reviewUrl: apt.reviewUrl ?? "",
  };
}

type Tr = { language: string; body: string; approval: string; metaTemplateName: string | null };

/** Guest language first, then the owner's fallback. In production only approved translations count. */
export function pickTranslation(
  translations: Tr[],
  guestLanguage: string,
  fallbackLanguage: string,
  mode: "dry-run" | "sandbox" | "production",
): { translation: Tr; usedFallback: boolean } | null {
  for (const lang of [guestLanguage, fallbackLanguage]) {
    const t = translations.find((x) => x.language === lang);
    if (!t) continue;
    // In production, require approval and metaTemplateName
    if (mode === "production" && !(t.approval === "APPROVED" && t.metaTemplateName)) continue;
    // In dry-run/sandbox, any translation is fine
    return { translation: t, usedFallback: lang !== guestLanguage };
  }
  return null;
}

export const renderText = fillTemplate;
