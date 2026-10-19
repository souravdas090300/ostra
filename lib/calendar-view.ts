import { diffDays } from "./dates";
import type { Stay, Turnover } from "./conflicts";
import { assignLanes, barGeometry } from "./timeline";

export const SOURCE_LABEL = {
  AIRBNB: "Airbnb",
  BOOKING_COM: "Booking.com",
  DIRECT: "Direct",
} as const;

export const SOURCE_LETTER = {
  AIRBNB: "A",
  BOOKING_COM: "B",
  DIRECT: "D",
} as const;

export type BarVM = {
  id: string;
  source: Stay["source"];
  isBlock: boolean;
  inYmd: string;
  outYmd: string;
  nights: number;
  label: string;
  guestName: string | null;
  guestPhone: string | null;
  left: number;
  width: number;
  lane: number;
  continuesLeft: boolean;
  continuesRight: boolean;
  doubleBooked: boolean;
};

export type RowVM = {
  apartmentId: string;
  name: string;
  laneCount: number;
  bars: BarVM[];
  blocks: BarVM[];
  turnovers: { dayIndex: number; gapHours: number; tight: boolean }[];
};

export function buildRows(a: {
  apartments: { id: string; name: string }[];
  stays: Stay[];
  from: string;
  days: number;
  doubleIds: Set<string>;
  turnovers: Turnover[];
}): RowVM[] {
  return a.apartments.map((apt) => {
    const mine = a.stays.filter((s) => s.apartmentId === apt.id);
    const real = mine.filter((s) => !s.isBlock);
    const { lanes, laneCount } = assignLanes(real);

    const toBar = (s: Stay, lane: number): BarVM | null => {
      const g = barGeometry(s, a.from, a.days);
      if (!g) return null;
      return {
        id: s.id,
        source: s.source,
        isBlock: s.isBlock,
        inYmd: s.inYmd,
        outYmd: s.outYmd,
        nights: diffDays(s.inYmd, s.outYmd),
        label: s.isBlock ? "Blocked" : s.guestName ?? SOURCE_LABEL[s.source],
        guestName: s.guestName,
        guestPhone: s.guestPhone,
        ...g,
        lane,
        doubleBooked: a.doubleIds.has(s.id),
      };
    };

    return {
      apartmentId: apt.id,
      name: apt.name,
      laneCount,
      bars: real
        .map((s) => toBar(s, lanes.get(s.id) ?? 0))
        .filter((b): b is BarVM => !!b),
      blocks: mine
        .filter((s) => s.isBlock)
        .map((s) => toBar(s, 0))
        .filter((b): b is BarVM => !!b),
      turnovers: a.turnovers
        .filter((t) => t.apartmentId === apt.id)
        .map((t) => ({
          dayIndex: diffDays(a.from, t.date),
          gapHours: t.gapHours,
          tight: t.tight,
        }))
        .filter((t) => t.dayIndex >= 0 && t.dayIndex < a.days),
    };
  });
}
