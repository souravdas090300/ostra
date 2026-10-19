import { loadStays } from "./calendar-data";
import { SOURCE_LABEL } from "./calendar-view";
import type { SourceName } from "./conflicts";

export type Overlap = {
  id: string;
  kind: "BOOKING" | "BLOCK";
  source: SourceName;
  label: string;
  inYmd: string;
  outYmd: string;
};

/** Non-cancelled stays or blocks in this apartment whose nights overlap [inYmd, outYmd). Back-to-back is not an overlap. */
export async function findOverlaps(
  ownerId: string,
  apartmentId: string,
  inYmd: string,
  outYmd: string,
  excludeId?: string
): Promise<Overlap[]> {
  const stays = await loadStays(ownerId, inYmd, outYmd); // already owner-scoped, hides cancelled
  return stays
    .filter(
      (s) =>
        s.apartmentId === apartmentId &&
        s.id !== excludeId &&
        s.inYmd < outYmd &&
        s.outYmd > inYmd
    )
    .map((s) => ({
      id: s.id,
      kind: s.isBlock ? "BLOCK" : "BOOKING",
      source: s.source,
      label: s.isBlock ? "Blocked dates" : s.guestName ?? SOURCE_LABEL[s.source],
      inYmd: s.inYmd,
      outYmd: s.outYmd,
    }));
}
