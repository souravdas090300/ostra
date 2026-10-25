import { createHash } from "crypto";
import { addDays } from "./dates";

export type ExportStay = {
  id: string;
  source: "AIRBNB" | "BOOKING_COM" | "DIRECT";
  isBlock: boolean;
  inYmd: string;
  outYmd: string;
  createdAt: Date;
};

const OWN: Record<string, "AIRBNB" | "BOOKING_COM"> = {
  AIRBNB: "AIRBNB",
  BOOKING_COM: "BOOKING_COM",
};
const HORIZON_DAYS = 730;

/** Real, future-relevant stays that the target platform does not already know about. Blocks are never exported. */
export function selectStays(target: string, stays: ExportStay[], todayYmd: string): ExportStay[] {
  const earliest = addDays(todayYmd, -1);
  const latest = addDays(todayYmd, HORIZON_DAYS);
  const ownSource = OWN[target];
  if (!ownSource) return [];
  
  return stays.filter(
    (s) => 
      !s.isBlock && 
      s.source !== ownSource && 
      s.outYmd > s.inYmd && 
      s.outYmd >= earliest && 
      s.inYmd <= latest,
  );
}

const compact = (ymd: string) => ymd.replaceAll("-", "");
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const fold = (line: string) => (line.match(/.{1,74}/g) ?? [""]).map((p, i) => (i ? " " + p : p)).join("\r\n");

/** RFC 5545 calendar, CRLF line endings, ASCII only, all-day events, no personal data. */
export function buildIcs(stays: ExportStay[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ostra//Availability Export//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Ostra availability",
  ];
  const sorted = [...stays].sort((a, b) => a.inYmd.localeCompare(b.inYmd) || a.id.localeCompare(b.id));
  for (const s of sorted) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${s.id}@ostra`,
      `DTSTAMP:${stamp(s.createdAt)}`,
      `DTSTART;VALUE=DATE:${compact(s.inYmd)}`,
      `DTEND;VALUE=DATE:${compact(s.outYmd)}`,
      "SUMMARY:Reserved",
      "STATUS:CONFIRMED",
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export const etagOf = (body: string) => `"${createHash("sha1").update(body).digest("hex")}"`;
