import { describe, it, expect } from "vitest";
import { feedIssues, STALE_AFTER_MS } from "../lib/feed-health";

describe("feed-health", () => {
  describe("feedIssues", () => {
    it("error beats never beats stale", () => {
      const now = new Date("2026-10-31T12:00:00Z");
      const feeds = [
        {
          id: "1",
          apartmentId: "apt-1",
          apartmentName: "Apt 1",
          source: "AIRBNB",
          lastSyncAt: now,
          lastSuccessAt: new Date("2026-10-31T08:00:00Z"),
          lastError: "Network error",
        },
        {
          id: "2",
          apartmentId: "apt-2",
          apartmentName: "Apt 2",
          source: "BOOKING_COM",
          lastSyncAt: null,
          lastSuccessAt: null,
          lastError: null,
        },
        {
          id: "3",
          apartmentId: "apt-3",
          apartmentName: "Apt 3",
          source: "DIRECT",
          lastSyncAt: new Date("2026-10-31T08:00:00Z"),
          lastSuccessAt: new Date("2026-10-31T05:00:00Z"),
          lastError: null,
        },
      ];
      const issues = feedIssues(feeds, now);
      expect(issues).toHaveLength(3);
      expect(issues[0].kind).toBe("error");
      expect(issues[1].kind).toBe("never");
      expect(issues[2].kind).toBe("stale");
    });

    it("exactly three hours is not stale", () => {
      const now = new Date("2026-10-31T12:00:00Z");
      const feeds = [
        {
          id: "1",
          apartmentId: "apt-1",
          apartmentName: "Apt 1",
          source: "AIRBNB",
          lastSyncAt: new Date("2026-10-31T09:00:00Z"),
          lastSuccessAt: new Date("2026-10-31T09:00:00Z"),
          lastError: null,
        },
      ];
      const issues = feedIssues(feeds, now);
      expect(issues).toHaveLength(0);
    });

    it("three hours and one minute is stale", () => {
      const now = new Date("2026-10-31T12:01:00Z");
      const feeds = [
        {
          id: "1",
          apartmentId: "apt-1",
          apartmentName: "Apt 1",
          source: "AIRBNB",
          lastSyncAt: new Date("2026-10-31T09:00:00Z"),
          lastSuccessAt: new Date("2026-10-31T09:00:00Z"),
          lastError: null,
        },
      ];
      const issues = feedIssues(feeds, now);
      expect(issues).toHaveLength(1);
      expect(issues[0].kind).toBe("stale");
    });

    it("healthy feed gives no issues", () => {
      const now = new Date("2026-10-31T12:00:00Z");
      const feeds = [
        {
          id: "1",
          apartmentId: "apt-1",
          apartmentName: "Apt 1",
          source: "AIRBNB",
          lastSyncAt: new Date("2026-10-31T11:00:00Z"),
          lastSuccessAt: new Date("2026-10-31T11:00:00Z"),
          lastError: null,
        },
      ];
      const issues = feedIssues(feeds, now);
      expect(issues).toHaveLength(0);
    });

    it("STALE_AFTER_MS is 3 hours", () => {
      expect(STALE_AFTER_MS).toBe(3 * 60 * 60 * 1000);
    });
  });
});
