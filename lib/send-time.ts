import { formatInTimeZone } from "date-fns-tz";
import { addDays } from "./dates";
import { TIMEZONE, maltaLocalToUtc, maltaYmd } from "./time";

type MessageType = "PRE_ARRIVAL" | "CHECK_IN" | "CHECK_OUT" | "REVIEW_REQUEST";

const HOUR = 3_600_000;
const GRACE_MS = 2 * HOUR;
export const WINDOW_START = 8; // 08:00 Malta
export const WINDOW_END = 21; // 21:00 Malta

const maltaHour = (d: Date) => Number(formatInTimeZone(d, TIMEZONE, "H"));
export const inAllowedWindow = (d: Date) => maltaHour(d) >= WINDOW_START && maltaHour(d) < WINDOW_END;

export function nextAllowedTime(from: Date): Date {
  const h = maltaHour(from);
  const ymd = maltaYmd(from);
  if (h < WINDOW_START) return maltaLocalToUtc(ymd, "08:00");
  if (h >= WINDOW_END) return maltaLocalToUtc(addDays(ymd, 1), "08:00");
  return from;
}

type Stay = { checkIn: Date; checkOut: Date };

export function plannedTime(type: MessageType, b: Stay): Date {
  const inYmd = maltaYmd(b.checkIn),
    outYmd = maltaYmd(b.checkOut);
  switch (type) {
    case "PRE_ARRIVAL":
      return maltaLocalToUtc(addDays(inYmd, -3), "10:00");
    case "CHECK_IN":
      return maltaLocalToUtc(inYmd, "09:00");
    case "CHECK_OUT":
      return maltaLocalToUtc(addDays(outYmd, -1), "18:00");
    case "REVIEW_REQUEST":
      return maltaLocalToUtc(addDays(outYmd, 1), "11:00");
    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}

export function latestUseful(type: MessageType, b: Stay): Date {
  switch (type) {
    case "PRE_ARRIVAL":
      return new Date(b.checkIn.getTime() - 3 * HOUR);
    case "CHECK_IN":
      return b.checkIn;
    case "CHECK_OUT":
      return new Date(b.checkOut.getTime() - 3 * HOUR);
    case "REVIEW_REQUEST":
      return new Date(b.checkOut.getTime() + 7 * 24 * HOUR);
  }
}

export type Plan = { sendAt: Date } | { skip: string };

export function planSend(type: MessageType, b: Stay, now: Date): Plan {
  const base = plannedTime(type, b);
  if (base.getTime() + GRACE_MS >= now.getTime()) return { sendAt: base }; // on time, or a little late
  if (type === "REVIEW_REQUEST") return { skip: "Too late to ask for a review." };
  const latest = latestUseful(type, b);
  if (now > latest) return { skip: "Too late to send this message." };
  const t = nextAllowedTime(now); // catch up
  return t > latest ? { skip: "Too late to send this message." } : { sendAt: t };
}
