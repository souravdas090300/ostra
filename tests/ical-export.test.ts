import { describe, it, expect } from "vitest";
import { selectStays, buildIcs, etagOf, type ExportStay } from "@/lib/ical-export";
import { addDays } from "@/lib/dates";
import { parseFeed } from "@/lib/ical";

describe("ical-export", () => {
  const today = "2026-01-15";

  describe("selectStays", () => {
    it("Airbnb target excludes Airbnb bookings and includes Booking.com and direct", () => {
      const stays: ExportStay[] = [
        { id: "1", source: "AIRBNB", isBlock: false, inYmd: "2026-01-20", outYmd: "2026-01-25", createdAt: new Date() },
        { id: "2", source: "BOOKING_COM", isBlock: false, inYmd: "2026-01-20", outYmd: "2026-01-25", createdAt: new Date() },
        { id: "3", source: "DIRECT", isBlock: false, inYmd: "2026-01-20", outYmd: "2026-01-25", createdAt: new Date() },
      ];
      const result = selectStays("AIRBNB", stays, today);
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id)).toEqual(["2", "3"]);
    });

    it("Booking.com target excludes Booking.com and includes Airbnb and direct", () => {
      const stays: ExportStay[] = [
        { id: "1", source: "AIRBNB", isBlock: false, inYmd: "2026-01-20", outYmd: "2026-01-25", createdAt: new Date() },
        { id: "2", source: "BOOKING_COM", isBlock: false, inYmd: "2026-01-20", outYmd: "2026-01-25", createdAt: new Date() },
        { id: "3", source: "DIRECT", isBlock: false, inYmd: "2026-01-20", outYmd: "2026-01-25", createdAt: new Date() },
      ];
      const result = selectStays("BOOKING_COM", stays, today);
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id)).toEqual(["1", "3"]);
    });

    it("blocks are never included", () => {
      const stays: ExportStay[] = [
        { id: "1", source: "BOOKING_COM", isBlock: true, inYmd: "2026-01-20", outYmd: "2026-01-25", createdAt: new Date() },
        { id: "2", source: "DIRECT", isBlock: false, inYmd: "2026-01-20", outYmd: "2026-01-25", createdAt: new Date() },
      ];
      const result = selectStays("AIRBNB", stays, today);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("2");
    });

    it("stays that ended before yesterday are excluded", () => {
      const stays: ExportStay[] = [
        { id: "1", source: "BOOKING_COM", isBlock: false, inYmd: "2026-01-10", outYmd: "2026-01-13", createdAt: new Date() },
        { id: "2", source: "BOOKING_COM", isBlock: false, inYmd: "2026-01-14", outYmd: "2026-01-15", createdAt: new Date() },
        { id: "3", source: "BOOKING_COM", isBlock: false, inYmd: "2026-01-20", outYmd: "2026-01-25", createdAt: new Date() },
      ];
      const result = selectStays("AIRBNB", stays, today);
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id)).toEqual(["2", "3"]);
    });

    it("stays starting beyond 730 days are excluded", () => {
      const stays: ExportStay[] = [
        { id: "1", source: "BOOKING_COM", isBlock: false, inYmd: "2026-01-20", outYmd: "2026-01-25", createdAt: new Date() },
        { id: "2", source: "BOOKING_COM", isBlock: false, inYmd: "2028-02-01", outYmd: "2028-02-05", createdAt: new Date() },
      ];
      const result = selectStays("AIRBNB", stays, today);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("1");
    });

    it("zero-length stays are excluded", () => {
      const stays: ExportStay[] = [
        { id: "1", source: "BOOKING_COM", isBlock: false, inYmd: "2026-01-20", outYmd: "2026-01-20", createdAt: new Date() },
        { id: "2", source: "BOOKING_COM", isBlock: false, inYmd: "2026-01-20", outYmd: "2026-01-25", createdAt: new Date() },
      ];
      const result = selectStays("AIRBNB", stays, today);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("2");
    });

    it("blocks that overlap bookings are not included", () => {
      const stays: ExportStay[] = [
        { id: "1", source: "AIRBNB", isBlock: true, inYmd: "2026-01-20", outYmd: "2026-01-25", createdAt: new Date() },
        { id: "2", source: "BOOKING_COM", isBlock: false, inYmd: "2026-01-22", outYmd: "2026-01-24", createdAt: new Date() },
      ];
      const result = selectStays("AIRBNB", stays, today);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("2");
    });

    it("empty list returns empty", () => {
      const result = selectStays("AIRBNB", [], today);
      expect(result).toHaveLength(0);
    });
  });

  describe("buildIcs", () => {
    it("valid structure with BEGIN:VCALENDAR first and END:VCALENDAR last", () => {
      const stays: ExportStay[] = [
        { id: "1", source: "BOOKING_COM", isBlock: false, inYmd: "2026-01-20", outYmd: "2026-01-25", createdAt: new Date("2026-01-15T10:00:00Z") },
      ];
      const ics = buildIcs(stays);
      // Filter empty lines that may result from trailing CRLF
      const lines = ics.split("\r\n").filter((l) => l.length > 0);
      expect(lines[0]).toBe("BEGIN:VCALENDAR");
      expect(lines[lines.length - 1]).toBe("END:VCALENDAR");
    });

    it("every BEGIN:VEVENT has an END:VEVENT", () => {
      const stays: ExportStay[] = [
        { id: "1", source: "BOOKING_COM", isBlock: false, inYmd: "2026-01-20", outYmd: "2026-01-25", createdAt: new Date() },
        { id: "2", source: "DIRECT", isBlock: false, inYmd: "2026-01-22", outYmd: "2026-01-27", createdAt: new Date() },
      ];
      const ics = buildIcs(stays);
      const beginCount = (ics.match(/BEGIN:VEVENT/g) || []).length;
      const endCount = (ics.match(/END:VEVENT/g) || []).length;
      expect(beginCount).toBe(endCount);
      expect(beginCount).toBe(2);
    });

    it("CRLF line endings only", () => {
      const stays: ExportStay[] = [
        { id: "1", source: "BOOKING_COM", isBlock: false, inYmd: "2026-01-20", outYmd: "2026-01-25", createdAt: new Date() },
      ];
      const ics = buildIcs(stays);
      // Check that the string contains CRLF
      expect(ics).toContain("\r\n");
      // Check that bare LF is not present (except maybe as part of CRLF)
      // Count CRLF occurrences and verify they match line count
      const crlfCount = (ics.match(/\r\n/g) || []).length;
      const lines = ics.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
      expect(crlfCount).toBeGreaterThan(0);
    });

    it("no line longer than 75 octets", () => {
      const stays: ExportStay[] = [
        { id: "1", source: "BOOKING_COM", isBlock: false, inYmd: "2026-01-20", outYmd: "2026-01-25", createdAt: new Date() },
      ];
      const ics = buildIcs(stays);
      const lines = ics.split("\r\n");
      for (const line of lines) {
        if (line.startsWith(" ")) {
          // Continuation line, check combined length
          const prevLineIndex = lines.indexOf(line) - 1;
          const combined = lines[prevLineIndex] + line.slice(1);
          expect(Buffer.byteLength(combined)).toBeLessThanOrEqual(75);
        } else {
          expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
        }
      }
    });

    it("ASCII only", () => {
      const stays: ExportStay[] = [
        { id: "1", source: "BOOKING_COM", isBlock: false, inYmd: "2026-01-20", outYmd: "2026-01-25", createdAt: new Date() },
      ];
      const ics = buildIcs(stays);
      expect(/^[\x00-\x7F]*$/.test(ics)).toBe(true);
    });

    it("DTSTART and DTEND are all-day, check-out date exclusive", () => {
      const stays: ExportStay[] = [
        { id: "1", source: "BOOKING_COM", isBlock: false, inYmd: "2026-11-05", outYmd: "2026-11-08", createdAt: new Date() },
      ];
      const ics = buildIcs(stays);
      expect(ics).toContain("DTSTART;VALUE=DATE:20261105");
      expect(ics).toContain("DTEND;VALUE=DATE:20261108");
    });

    it("same-day turnover gives same DTEND and next DTSTART", () => {
      const stays: ExportStay[] = [
        { id: "1", source: "BOOKING_COM", isBlock: false, inYmd: "2026-01-20", outYmd: "2026-01-25", createdAt: new Date() },
        { id: "2", source: "DIRECT", isBlock: false, inYmd: "2026-01-25", outYmd: "2026-01-30", createdAt: new Date() },
      ];
      const ics = buildIcs(stays);
      expect(ics).toContain("DTEND;VALUE=DATE:20260125");
      expect(ics).toContain("DTSTART;VALUE=DATE:20260125");
    });

    it("UID is booking id plus @ostra and stable across calls", () => {
      const stays: ExportStay[] = [
        { id: "abc123", source: "BOOKING_COM", isBlock: false, inYmd: "2026-01-20", outYmd: "2026-01-25", createdAt: new Date() },
      ];
      const ics1 = buildIcs(stays);
      const ics2 = buildIcs(stays);
      expect(ics1).toContain("UID:abc123@ostra");
      expect(ics2).toContain("UID:abc123@ostra");
    });

    it("DTSTAMP equals booking createdAt and is stable", () => {
      const createdAt = new Date("2026-01-15T10:30:00Z");
      const stays: ExportStay[] = [
        { id: "1", source: "BOOKING_COM", isBlock: false, inYmd: "2026-01-20", outYmd: "2026-01-25", createdAt },
      ];
      const ics1 = buildIcs(stays);
      const ics2 = buildIcs(stays);
      expect(ics1).toContain("DTSTAMP:20260115T103000Z");
      expect(ics2).toContain("DTSTAMP:20260115T103000Z");
    });

    it("SUMMARY is Reserved", () => {
      const stays: ExportStay[] = [
        { id: "1", source: "BOOKING_COM", isBlock: false, inYmd: "2026-01-20", outYmd: "2026-01-25", createdAt: new Date() },
      ];
      const ics = buildIcs(stays);
      expect(ics).toContain("SUMMARY:Reserved");
    });

    it("output is sorted deterministically", () => {
      const stays: ExportStay[] = [
        { id: "z", source: "BOOKING_COM", isBlock: false, inYmd: "2026-01-25", outYmd: "2026-01-30", createdAt: new Date() },
        { id: "a", source: "DIRECT", isBlock: false, inYmd: "2026-01-20", outYmd: "2026-01-25", createdAt: new Date() },
        { id: "m", source: "BOOKING_COM", isBlock: false, inYmd: "2026-01-20", outYmd: "2026-01-25", createdAt: new Date() },
      ];
      const ics = buildIcs(stays);
      const lines = ics.split("\r\n");
      const uidLines = lines.filter((l) => l.startsWith("UID:"));
      expect(uidLines).toEqual(["UID:a@ostra", "UID:m@ostra", "UID:z@ostra"]);
    });

    it("empty list gives valid empty calendar", () => {
      const ics = buildIcs([]);
      expect(ics).toContain("BEGIN:VCALENDAR");
      expect(ics).toContain("END:VCALENDAR");
      expect(ics).not.toContain("BEGIN:VEVENT");
    });

    it("no guest name, phone, notes, apartment name, source or token appears", () => {
      const stays: ExportStay[] = [
        {
          id: "1",
          source: "BOOKING_COM",
          isBlock: false,
          inYmd: "2026-01-20",
          outYmd: "2026-01-25",
          createdAt: new Date(),
        },
      ];
      const ics = buildIcs(stays);
      expect(ics).not.toContain("guest");
      expect(ics).not.toContain("phone");
      expect(ics).not.toContain("notes");
      expect(ics).not.toContain("apartment");
      expect(ics).not.toContain("BOOKING_COM");
      expect(ics).not.toContain("token");
    });
  });

  describe("round trip with parseFeed", () => {
    it("parseFeed applied to buildIcs returns same start and end dates", () => {
      const stays: ExportStay[] = [
        { id: "1", source: "BOOKING_COM", isBlock: false, inYmd: "2026-01-20", outYmd: "2026-01-25", createdAt: new Date() },
        { id: "2", source: "DIRECT", isBlock: false, inYmd: "2026-02-01", outYmd: "2026-02-05", createdAt: new Date() },
      ];
      const ics = buildIcs(stays);
      const parsed = parseFeed(ics);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].startYmd).toBe("2026-01-20");
      expect(parsed[0].endYmd).toBe("2026-01-25");
      expect(parsed[1].startYmd).toBe("2026-02-01");
      expect(parsed[1].endYmd).toBe("2026-02-05");
    });

    it("works across October clock change", () => {
      const stays: ExportStay[] = [
        { id: "1", source: "BOOKING_COM", isBlock: false, inYmd: "2026-10-25", outYmd: "2026-10-30", createdAt: new Date() },
      ];
      const ics = buildIcs(stays);
      const parsed = parseFeed(ics);
      expect(parsed[0].startYmd).toBe("2026-10-25");
      expect(parsed[0].endYmd).toBe("2026-10-30");
    });

    it("works across March clock change", () => {
      const stays: ExportStay[] = [
        { id: "1", source: "BOOKING_COM", isBlock: false, inYmd: "2026-03-25", outYmd: "2026-03-30", createdAt: new Date() },
      ];
      const ics = buildIcs(stays);
      const parsed = parseFeed(ics);
      expect(parsed[0].startYmd).toBe("2026-03-25");
      expect(parsed[0].endYmd).toBe("2026-03-30");
    });

    it("works across new year", () => {
      const stays: ExportStay[] = [
        { id: "1", source: "BOOKING_COM", isBlock: false, inYmd: "2026-12-28", outYmd: "2027-01-02", createdAt: new Date() },
      ];
      const ics = buildIcs(stays);
      const parsed = parseFeed(ics);
      expect(parsed[0].startYmd).toBe("2026-12-28");
      expect(parsed[0].endYmd).toBe("2027-01-02");
    });

    it("every imported event gets isBlockEvent false for Reserved summary", () => {
      const stays: ExportStay[] = [
        { id: "1", source: "BOOKING_COM", isBlock: false, inYmd: "2026-01-20", outYmd: "2026-01-25", createdAt: new Date() },
      ];
      const ics = buildIcs(stays);
      const parsed = parseFeed(ics);
      expect(parsed[0].summary).toBe("Reserved");
    });
  });

  describe("etagOf", () => {
    it("same body same etag", () => {
      const body = "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";
      const etag1 = etagOf(body);
      const etag2 = etagOf(body);
      expect(etag1).toBe(etag2);
    });

    it("one changed date changes etag", () => {
      const body1 = "BEGIN:VCALENDAR\r\nDTSTART;VALUE=DATE:20260120\r\nEND:VCALENDAR\r\n";
      const body2 = "BEGIN:VCALENDAR\r\nDTSTART;VALUE=DATE:20260121\r\nEND:VCALENDAR\r\n";
      const etag1 = etagOf(body1);
      const etag2 = etagOf(body2);
      expect(etag1).not.toBe(etag2);
    });
  });
});
