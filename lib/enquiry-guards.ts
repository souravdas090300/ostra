export function unsupportedAmounts(reply: string, allowed: Set<number>): boolean {
  const re = /(?:€|eur(?:os?)?)\s*(\d[\d.,\s]*\d|\d)|(\d[\d.,\s]*\d|\d)\s*(?:€|eur(?:os?)?)/gi;
  for (const m of reply.matchAll(re)) {
    const raw = (m[1] ?? m[2]).replace(/\s/g, "");
    const n = parseEuro(raw);
    if (n == null || !allowed.has(n)) return true;
  }
  return false;
}

function parseEuro(s: string): number | null {
  // Remove all non-digit except decimal points and commas
  const cleaned = s.replace(/[^\d.,]/g, "");
  // Handle both European (1.200,50) and US (1,200.50) formats
  const normalized = cleaned.replace(/\./g, "").replace(/,/g, ".");
  const parsed = parseFloat(normalized);
  return isNaN(parsed) ? null : parsed;
}
