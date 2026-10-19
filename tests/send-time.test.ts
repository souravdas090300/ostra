import { describe, it, expect } from "vitest";
import {
  plannedTime,
  latestUseful,
  planSend,
  inAllowedWindow,
  nextAllowedTime,
  WINDOW_START,
  WINDOW_END,
} from "@/lib/send-time";

describe("send-time", () => {
  const winterStay = {
    checkIn: new Date("2026-11-05T14:00:00.000Z"), // 15:00 Malta (UTC+1)
    checkOut: new Date("2026-11-10T11:00:00.000Z"), // 12:00 Malta (UTC+1)
  };

  const summerStay = {
    checkIn: new Date("2027-07-10T13:00:00.000Z"), // 15:00 Malta (UTC+2)
    checkOut: new Date("2027-07-15T11:00:00.000Z"), // 13:00 Malta (UTC+2)
  };

  describe("plannedTime", () => {
    it("calculates PRE_ARRIVAL for winter stay", () => {
      const result = plannedTime("PRE_ARRIVAL", winterStay);
      // 3 days before Nov 5 at 10:00 Malta (UTC+1) = Nov 2 09:00 UTC
      expect(result.toISOString()).toBe("2026-11-02T09:00:00.000Z");
    });

    it("calculates CHECK_IN for winter stay", () => {
      const result = plannedTime("CHECK_IN", winterStay);
      // Nov 5 at 09:00 Malta (UTC+1) = Nov 5 08:00 UTC
      expect(result.toISOString()).toBe("2026-11-05T08:00:00.000Z");
    });

    it("calculates CHECK_OUT for winter stay", () => {
      const result = plannedTime("CHECK_OUT", winterStay);
      // Day before Nov 10 at 18:00 Malta (UTC+1) = Nov 9 17:00 UTC
      expect(result.toISOString()).toBe("2026-11-09T17:00:00.000Z");
    });

    it("calculates REVIEW_REQUEST for winter stay", () => {
      const result = plannedTime("REVIEW_REQUEST", winterStay);
      // Day after Nov 10 at 11:00 Malta (UTC+1) = Nov 11 10:00 UTC
      expect(result.toISOString()).toBe("2026-11-11T10:00:00.000Z");
    });

    it("calculates PRE_ARRIVAL for summer stay", () => {
      const result = plannedTime("PRE_ARRIVAL", summerStay);
      // 3 days before July 10 at 10:00 Malta (UTC+2) = July 7 08:00 UTC
      expect(result.toISOString()).toBe("2027-07-07T08:00:00.000Z");
    });
  });

  describe("latestUseful", () => {
    it("calculates latest useful for PRE_ARRIVAL", () => {
      const result = latestUseful("PRE_ARRIVAL", winterStay);
      // 3 hours before check-in
      expect(result.toISOString()).toBe("2026-11-05T11:00:00.000Z");
    });

    it("calculates latest useful for CHECK_IN", () => {
      const result = latestUseful("CHECK_IN", winterStay);
      // At check-in time
      expect(result.toISOString()).toBe("2026-11-05T14:00:00.000Z");
    });

    it("calculates latest useful for CHECK_OUT", () => {
      const result = latestUseful("CHECK_OUT", winterStay);
      // 3 hours before check-out
      expect(result.toISOString()).toBe("2026-11-10T08:00:00.000Z");
    });

    it("calculates latest useful for REVIEW_REQUEST", () => {
      const result = latestUseful("REVIEW_REQUEST", winterStay);
      // 7 days after check-out
      expect(result.toISOString()).toBe("2026-11-17T11:00:00.000Z");
    });
  });

  describe("planSend", () => {
    it("sends on time when scheduled", () => {
      const now = new Date("2026-11-02T08:00:00.000Z");
      const result = planSend("PRE_ARRIVAL", winterStay, now);
      expect("sendAt" in result).toBe(true);
      if ("sendAt" in result) {
        expect(result.sendAt.toISOString()).toBe("2026-11-02T09:00:00.000Z");
      }
    });

    it("sends when within grace period (2 hours)", () => {
      const now = new Date("2026-11-02T10:30:00.000Z"); // 1.5 hours late
      const result = planSend("PRE_ARRIVAL", winterStay, now);
      expect("sendAt" in result).toBe(true);
    });

    it("catches up when late but still useful", () => {
      const now = new Date("2026-11-02T15:00:00.000Z"); // 6 hours late (16:00 Malta)
      const result = planSend("PRE_ARRIVAL", winterStay, now);
      expect("sendAt" in result).toBe(true);
      if ("sendAt" in result) {
        // Should be the current time since it's still within the allowed window (08:00-21:00)
        expect(result.sendAt.toISOString()).toBe("2026-11-02T15:00:00.000Z");
      }
    });

    it("skips when too late", () => {
      const now = new Date("2026-11-05T12:00:00.000Z"); // After latest useful
      const result = planSend("PRE_ARRIVAL", winterStay, now);
      expect("skip" in result).toBe(true);
      if ("skip" in result) {
        expect(result.skip).toBe("Too late to send this message.");
      }
    });

    it("skips REVIEW_REQUEST when more than 2 hours late", () => {
      const now = new Date("2026-11-11T13:00:00.000Z"); // 3 hours late
      const result = planSend("REVIEW_REQUEST", winterStay, now);
      expect("skip" in result).toBe(true);
      if ("skip" in result) {
        expect(result.skip).toBe("Too late to ask for a review.");
      }
    });

    it("sends REVIEW_REQUEST when within 2 hours late", () => {
      const now = new Date("2026-11-11T11:30:00.000Z"); // 1.5 hours late
      const result = planSend("REVIEW_REQUEST", winterStay, now);
      expect("sendAt" in result).toBe(true);
    });

    it("catches up to next day when late but before 21:00", () => {
      const now = new Date("2026-11-02T20:00:00.000Z"); // Malta time is 21:00
      const result = planSend("PRE_ARRIVAL", winterStay, now);
      expect("sendAt" in result).toBe(true);
      if ("sendAt" in result) {
        // Should be 08:00 next day
        expect(result.sendAt.toISOString()).toBe("2026-11-03T07:00:00.000Z");
      }
    });

    it("skips when catch-up would land after latest useful", () => {
      const now = new Date("2026-11-05T23:00:00.000Z"); // After quiet hours, past latest useful
      const result = planSend("PRE_ARRIVAL", winterStay, now);
      expect("skip" in result).toBe(true);
    });

    it("handles one-night stay CHECK_OUT on arrival evening", () => {
      const oneNight = {
        checkIn: new Date("2026-11-05T14:00:00.000Z"),
        checkOut: new Date("2026-11-06T11:00:00.000Z"),
      };
      const result = plannedTime("CHECK_OUT", oneNight);
      // Day before Nov 6 at 18:00 Malta = Nov 5 17:00 UTC
      expect(result.toISOString()).toBe("2026-11-05T17:00:00.000Z");
    });
  });

  describe("inAllowedWindow", () => {
    it("returns false before 08:00", () => {
      const time = new Date("2026-11-05T06:00:00.000Z"); // 07:00 Malta
      expect(inAllowedWindow(time)).toBe(false);
    });

    it("returns true at 08:00", () => {
      const time = new Date("2026-11-05T07:00:00.000Z"); // 08:00 Malta
      expect(inAllowedWindow(time)).toBe(true);
    });

    it("returns true during the day", () => {
      const time = new Date("2026-11-05T12:00:00.000Z"); // 13:00 Malta
      expect(inAllowedWindow(time)).toBe(true);
    });

    it("returns true at 20:59", () => {
      const time = new Date("2026-11-05T19:59:00.000Z"); // 20:59 Malta
      expect(inAllowedWindow(time)).toBe(true);
    });

    it("returns false at 21:00", () => {
      const time = new Date("2026-11-05T20:00:00.000Z"); // 21:00 Malta
      expect(inAllowedWindow(time)).toBe(false);
    });
  });

  describe("nextAllowedTime", () => {
    it("returns 08:00 on same day when before window", () => {
      const time = new Date("2026-11-05T06:00:00.000Z"); // 07:00 Malta
      const result = nextAllowedTime(time);
      expect(result.toISOString()).toBe("2026-11-05T07:00:00.000Z");
    });

    it("returns same time when in window", () => {
      const time = new Date("2026-11-05T12:00:00.000Z"); // 13:00 Malta
      const result = nextAllowedTime(time);
      expect(result.toISOString()).toBe("2026-11-05T12:00:00.000Z");
    });

    it("returns 08:00 next day when after window", () => {
      const time = new Date("2026-11-05T20:00:00.000Z"); // 21:00 Malta
      const result = nextAllowedTime(time);
      expect(result.toISOString()).toBe("2026-11-06T07:00:00.000Z");
    });
  });
});
