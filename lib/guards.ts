const URL_RE = /https?:\/\/[^\s)>\]]+/gi;
const clean = (u: string) => u.replace(/[.,;:!?]+$/, "").toLowerCase();
const digitsOnly = (s: string) => s.replace(/\D/g, "");

/** Returns a description if the reply contains a link or a phone-like number that is not in the host's text, else null. */
export function unsupportedContacts(reply: string, allowedText: string): string | null {
  const allowedUrls = new Set((allowedText.match(URL_RE) ?? []).map(clean));
  for (const u of reply.match(URL_RE) ?? []) if (!allowedUrls.has(clean(u))) return "link";
  const allowedDigits = digitsOnly(allowedText);
  for (const m of reply.matchAll(/\+?\d[\d\s().-]{5,}\d/g)) {
    const d = digitsOnly(m[0]);
    if (d.length >= 7 && !allowedDigits.includes(d)) return "number";
  }
  return null;
}

/** Exact STOP and UNSUBSCRIBE only (the word in the templates). Other languages are handled by the model. */
export function isStopKeyword(body: string): boolean {
  const t = body.trim().toLowerCase().replace(/[.!?\s]+$/g, "");
  return t === "stop" || t === "unsubscribe" || t === "stop all" || t === "stop messages";
}
