import { fromZonedTime, formatInTimeZone } from "date-fns-tz";

export const TIMEZONE = "Europe/Malta";

/** "2026-11-05" + "15:00" in Malta time -> UTC Date. Handles daylight saving. */
export function maltaLocalToUtc(ymd: string, hhmm: string): Date {
  return fromZonedTime(`${ymd}T${hhmm}:00`, TIMEZONE);
}

export function maltaYmd(d: Date): string {
  return formatInTimeZone(d, TIMEZONE, "yyyy-MM-dd");
}
