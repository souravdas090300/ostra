import { describe, it, expect } from "vitest";
import {
  isValidYmd,
  addDays,
  diffDays,
  todayMalta,
  eachDay,
  weekday,
  parseFromParam,
  formatYmd,
  timeAgo,
} from "../lib/dates";

describe("dates", () => {
  describe("isValidYmd", () => {
    it("accepts valid dates", () => {
      expect(isValidYmd("2026-10-31")).toBe(true);
      expect(isValidYmd("2024-02-29")).toBe(true); // leap day
    });

    it("rejects invalid dates", () => {
      expect(isValidYmd("2026-02-30")).toBe(false);
      expect(isValidYmd("2026-13-01")).toBe(false);
      expect(isValidYmd("2026-10-32")).toBe(false);
      expect(isValidYmd("garbage")).toBe(false);
      expect(isValidYmd("")).toBe(false);
    });
  });

  describe("addDays", () => {
    it("adds days correctly", () => {
      expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
      expect(addDays("2026-10-31", -1)).toBe("2026-10-30");
      expect(addDays("2026-10-31", 0)).toBe("2026-10-31");
    });

    it("handles daylight saving transitions (UTC arithmetic)", () => {
      // October clock change in Malta (last Sunday of October)
      expect(addDays("2026-10-24", 3)).toBe("2026-10-27");
      // March clock change in Malta (last Sunday of March)
      expect(addDays("2026-03-27", 3)).toBe("2026-03-30");
    });

    it("handles leap day", () => {
      expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
      expect(addDays("2024-02-29", 1)).toBe("2024-03-01");
    });
  });

  describe("diffDays", () => {
    it("calculates difference correctly", () => {
      expect(diffDays("2026-10-31", "2026-11-01")).toBe(1);
      expect(diffDays("2026-10-31", "2026-11-07")).toBe(7);
      expect(diffDays("2026-11-01", "2026-10-31")).toBe(-1);
    });

    it("is symmetric", () => {
      expect(diffDays("2026-10-31", "2026-11-07")).toBe(-diffDays("2026-11-07", "2026-10-31"));
    });
  });

  describe("todayMalta", () => {
    it("returns today in Malta timezone", () => {
      const today = todayMalta();
      expect(isValidYmd(today)).toBe(true);
    });
  });

  describe("eachDay", () => {
    it("generates array of days", () => {
      expect(eachDay("2026-10-31", 3)).toEqual(["2026-10-31", "2026-11-01", "2026-11-02"]);
    });

    it("handles empty range", () => {
      expect(eachDay("2026-10-31", 0)).toEqual([]);
    });
  });

  describe("weekday", () => {
    it("returns correct weekday (0 = Sunday)", () => {
      expect(weekday("2026-10-31")).toBe(6); // Saturday
      expect(weekday("2026-11-01")).toBe(0); // Sunday
    });
  });

  describe("parseFromParam", () => {
    it("accepts valid dates within two years", () => {
      const today = "2026-10-31";
      expect(parseFromParam("2026-10-31", today)).toBe("2026-10-31");
      expect(parseFromParam("2027-10-31", today)).toBe("2027-10-31");
      expect(parseFromParam("2024-11-01", today)).toBe("2024-11-01");
    });

    it("rejects dates over two years away", () => {
      const today = "2026-10-31";
      expect(parseFromParam("2029-11-01", today)).toBeNull();
      expect(parseFromParam("2024-10-30", today)).toBeNull();
    });

    it("rejects garbage", () => {
      const today = "2026-10-31";
      expect(parseFromParam("garbage", today)).toBeNull();
      expect(parseFromParam(undefined, today)).toBeNull();
    });
  });

  describe("formatYmd", () => {
    it("formats date with weekday", () => {
      expect(formatYmd("2026-10-31", true)).toMatch(/Sat.*31.*Oct/);
    });

    it("formats date without weekday", () => {
      expect(formatYmd("2026-10-31", false)).toMatch(/31.*Oct/);
    });
  });

  describe("timeAgo", () => {
    it("returns minutes ago", () => {
      const now = new Date("2026-10-31T12:00:00Z");
      const then = new Date("2026-10-31T11:30:00Z");
      expect(timeAgo(then, now)).toBe("30 min ago");
    });

    it("returns hours ago", () => {
      const now = new Date("2026-10-31T12:00:00Z");
      const then = new Date("2026-10-31T08:00:00Z");
      expect(timeAgo(then, now)).toBe("4 h ago");
    });

    it("returns days ago", () => {
      const now = new Date("2026-10-31T12:00:00Z");
      const then = new Date("2026-10-29T12:00:00Z");
      expect(timeAgo(then, now)).toBe("2 days ago");
    });

    it("handles future times", () => {
      const now = new Date("2026-10-31T12:00:00Z");
      const then = new Date("2026-10-31T12:30:00Z");
      expect(timeAgo(then, now)).toBe("0 min ago");
    });
  });
});
