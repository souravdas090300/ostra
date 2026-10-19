import { diffDays } from "./dates";
import type { Stay } from "./conflicts";

/** Greedy lane packing: stays that touch (out == next in) share a lane; overlapping stays get separate lanes. */
export function assignLanes(stays: Pick<Stay, "id" | "inYmd" | "outYmd">[]) {
  const sorted = [...stays].sort(
    (a, b) =>
      a.inYmd.localeCompare(b.inYmd) ||
      a.outYmd.localeCompare(b.outYmd) ||
      a.id.localeCompare(b.id)
  );
  const laneEnds: string[] = [];
  const lanes = new Map<string, number>();
  for (const s of sorted) {
    let lane = laneEnds.findIndex((end) => end <= s.inYmd);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(s.outYmd);
    } else laneEnds[lane] = s.outYmd;
    lanes.set(s.id, lane);
  }
  return { lanes, laneCount: Math.max(1, laneEnds.length) };
}

export type Geometry = {
  left: number;
  width: number;
  continuesLeft: boolean;
  continuesRight: boolean;
};

/**
 * Positions are in "day units" from the first visible day. A stay starts at the middle of its
 * check-in day (+0.5) and ends at the middle of its check-out day (+0.5). Returns null if not visible.
 */
export function barGeometry(
  stay: Pick<Stay, "inYmd" | "outYmd">,
  from: string,
  days: number
): Geometry | null {
  const start = diffDays(from, stay.inYmd) + 0.5;
  const end = diffDays(from, stay.outYmd) + 0.5;
  if (end <= 0 || start >= days) return null;
  const left = Math.max(0, start);
  const right = Math.min(days, end);
  return {
    left,
    width: right - left,
    continuesLeft: start < 0,
    continuesRight: end > days,
  };
}
