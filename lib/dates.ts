import { maltaYmd } from "./time";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isValidYmd(s: string): boolean {
  if (!YMD.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Day arithmetic on date strings, done in UTC so daylight saving cannot interfere. */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export const todayMalta = (now: Date = new Date()): string => maltaYmd(now);

export const eachDay = (from: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => addDays(from, i));

/** 0 = Sunday ... 6 = Saturday */
export const weekday = (ymd: string): number => new Date(`${ymd}T00:00:00Z`).getUTCDay();

/** Accept ?from=YYYY-MM-DD only if it is a real date within two years of today. */
export function parseFromParam(raw: string | undefined, today: string): string | null {
  if (!raw || !isValidYmd(raw)) return null;
  return Math.abs(diffDays(today, raw)) > 730 ? null : raw;
}

export function formatYmd(ymd: string, withWeekday = true): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: withWeekday ? "short" : undefined,
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function timeAgo(then: Date, now: Date = new Date()): string {
  const mins = Math.max(0, Math.round((now.getTime() - then.getTime()) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}
