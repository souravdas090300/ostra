import { addDays } from "./dates";

export type SourceName = "AIRBNB" | "BOOKING_COM" | "DIRECT";

export type Stay = {
  id: string;
  apartmentId: string;
  source: SourceName;
  isBlock: boolean;
  inYmd: string; // Malta date of check-in
  outYmd: string; // Malta date of check-out
  checkIn: Date; // instant, used only for turnover gap hours
  checkOut: Date;
  guestName: string | null;
  guestPhone: string | null;
};

export type DoubleBooking = {
  apartmentId: string;
  a: Stay;
  b: Stay;
  overlapFrom: string;
  overlapTo: string;
};

export type Turnover = {
  apartmentId: string;
  outgoing: Stay;
  incoming: Stay;
  date: string;
  gapHours: number;
  tight: boolean;
};

export const TIGHT_TURNOVER_HOURS = 3;

const byApartment = (stays: Stay[]) => {
  const m = new Map<string, Stay[]>();
  for (const s of stays) {
    if (s.isBlock) continue; // blocks never take part in conflicts
    (m.get(s.apartmentId) ?? m.set(s.apartmentId, []).get(s.apartmentId)!).push(s);
  }
  return m;
};

/** Two stays in the same apartment whose nights overlap. Back-to-back stays do not overlap. */
export function findDoubleBookings(stays: Stay[]): DoubleBooking[] {
  const out: DoubleBooking[] = [];
  for (const [apartmentId, list] of byApartment(stays)) {
    const sorted = [...list].sort(
      (x, y) => x.inYmd.localeCompare(y.inYmd) || x.id.localeCompare(y.id)
    );
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length && sorted[j].inYmd < sorted[i].outYmd; j++) {
        const a = sorted[i],
          b = sorted[j];
        out.push({
          apartmentId,
          a,
          b,
          overlapFrom: b.inYmd > a.inYmd ? b.inYmd : a.inYmd,
          overlapTo: a.outYmd < b.outYmd ? a.outYmd : b.outYmd,
        });
      }
    }
  }
  return out;
}

/** A check-out and a check-in on the same date in the same apartment. */
export function findTurnovers(stays: Stay[]): Turnover[] {
  const out: Turnover[] = [];
  for (const [apartmentId, list] of byApartment(stays)) {
    const arrivalsByDate = new Map<string, Stay[]>();
    for (const s of list)
      (arrivalsByDate.get(s.inYmd) ?? arrivalsByDate.set(s.inYmd, []).get(s.inYmd)!).push(s);
    for (const outgoing of list) {
      for (const incoming of arrivalsByDate.get(outgoing.outYmd) ?? []) {
        if (incoming.id === outgoing.id) continue;
        const gapHours = (incoming.checkIn.getTime() - outgoing.checkOut.getTime()) / 3_600_000;
        out.push({
          apartmentId,
          outgoing,
          incoming,
          date: outgoing.outYmd,
          gapHours,
          tight: gapHours < TIGHT_TURNOVER_HOURS,
        });
      }
    }
  }
  return out;
}

/** Guest arrivals in the next N days that have no phone number, so automatic messages cannot send. */
export function findMissingContacts(stays: Stay[], today: string, withinDays = 7): Stay[] {
  const last = addDays(today, withinDays);
  return stays
    .filter((s) => !s.isBlock && !s.guestPhone && s.inYmd >= today && s.inYmd <= last)
    .sort((a, b) => a.inYmd.localeCompare(b.inYmd));
}

export type DaySummary = {
  arrivals: Stay[];
  departures: Stay[];
  inHouse: Stay[];
  turnoverApartments: Set<string>;
};

export function daySummary(stays: Stay[], ymd: string): DaySummary {
  const real = stays.filter((s) => !s.isBlock);
  const arrivals = real.filter((s) => s.inYmd === ymd);
  const departures = real.filter((s) => s.outYmd === ymd);
  const inHouse = real.filter((s) => s.inYmd < ymd && s.outYmd > ymd);
  const turnoverApartments = new Set(
    arrivals.map((a) => a.apartmentId).filter((id) => departures.some((d) => d.apartmentId === id))
  );
  return { arrivals, departures, inHouse, turnoverApartments };
}
