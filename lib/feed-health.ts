export const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

export type FeedHealthInput = {
  id: string;
  apartmentId: string;
  apartmentName: string;
  source: string;
  lastSyncAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
};

export type FeedIssue = {
  feedId: string;
  apartmentId: string;
  apartmentName: string;
  source: string;
  kind: "never" | "error" | "stale";
  detail?: string;
  since?: Date;
};

/** One issue per feed at most: error beats never beats stale. */
export function feedIssues(feeds: FeedHealthInput[], now: Date = new Date()): FeedIssue[] {
  const out: FeedIssue[] = [];
  for (const f of feeds) {
    const base = {
      feedId: f.id,
      apartmentId: f.apartmentId,
      apartmentName: f.apartmentName,
      source: f.source,
    };
    if (f.lastError)
      out.push({
        ...base,
        kind: "error",
        detail: f.lastError,
        since: f.lastSuccessAt ?? undefined,
      });
    else if (!f.lastSuccessAt) out.push({ ...base, kind: "never" });
    else if (now.getTime() - f.lastSuccessAt.getTime() > STALE_AFTER_MS)
      out.push({ ...base, kind: "stale", since: f.lastSuccessAt });
  }
  return out;
}
