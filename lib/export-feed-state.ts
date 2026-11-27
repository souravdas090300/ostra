export type LinkState = "DISABLED" | "WAITING" | "CONNECTED" | "STALE";

export function linkState(
  f: { enabled: boolean; lastFetchedAt: Date | null },
  now = new Date(),
  staleHours = Number(process.env.EXPORT_STALE_AFTER_HOURS ?? 48),
): LinkState {
  if (!f.enabled) return "DISABLED";
  if (!f.lastFetchedAt) return "WAITING";
  return now.getTime() - f.lastFetchedAt.getTime() > staleHours * 3_600_000 ? "STALE" : "CONNECTED";
}
