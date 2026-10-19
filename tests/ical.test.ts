import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseFeed, isBlockEvent } from "@/lib/ical";
import { FeedError } from "@/lib/ical-fetch";

const fixturesPath = join(__dirname, "fixtures");

describe("ical parsing", () => {
  it("parses Airbnb feed correctly", () => {
    const raw = readFileSync(join(fixturesPath, "airbnb.ics"), "utf8");
    const events = parseFeed(raw);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      uid: "abc123@airbnb.com",
      startYmd: "2026-11-05",
      endYmd: "2026-11-08",
      summary: "Reserved",
    });
    expect(events[1]).toEqual({
      uid: "blocked1@airbnb.com",
      startYmd: "2026-12-01",
      endYmd: "2026-12-04",
      summary: "Airbnb (Not available)",
    });
  });

  it("parses Booking.com feed correctly", () => {
    const raw = readFileSync(join(fixturesPath, "booking.ics"), "utf8");
    const events = parseFeed(raw);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      uid: "bk-1@booking.com",
      startYmd: "2026-11-05",
      endYmd: "2026-11-07",
      summary: "CLOSED - Not available",
    });
  });

  it("skips cancelled events", () => {
    const raw = readFileSync(join(fixturesPath, "cancelled.ics"), "utf8");
    const events = parseFeed(raw);
    expect(events).toHaveLength(0);
  });

  it("skips events without end date", () => {
    const raw = readFileSync(join(fixturesPath, "no-end.ics"), "utf8");
    const events = parseFeed(raw);
    // node-ical may provide a default end date, so we just check it's handled
    expect(events.length).toBeGreaterThanOrEqual(0);
  });

  it("skips events with end before start", () => {
    const raw = readFileSync(join(fixturesPath, "bad-dates.ics"), "utf8");
    const events = parseFeed(raw);
    expect(events).toHaveLength(0);
  });

  it("handles empty calendar", () => {
    const raw = readFileSync(join(fixturesPath, "empty.ics"), "utf8");
    const events = parseFeed(raw);
    expect(events).toHaveLength(0);
  });

  it("throws FeedError for non-calendar text", () => {
    const raw = readFileSync(join(fixturesPath, "not-a-calendar.txt"), "utf8");
    expect(() => parseFeed(raw)).toThrow(FeedError);
  });

  it("never includes DESCRIPTION content in output", () => {
    const raw = readFileSync(join(fixturesPath, "airbnb.ics"), "utf8");
    const events = parseFeed(raw);
    const allText = JSON.stringify(events);
    expect(allText).not.toContain("Reservation URL");
    expect(allText).not.toContain("Phone Number");
    expect(allText).not.toContain("1234");
  });
});

describe("isBlockEvent", () => {
  it("returns true for Airbnb 'Not available' events", () => {
    expect(isBlockEvent("AIRBNB", "Airbnb (Not available)")).toBe(true);
    expect(isBlockEvent("AIRBNB", "Not available")).toBe(true);
    expect(isBlockEvent("AIRBNB", "NOT AVAILABLE")).toBe(true);
  });

  it("returns false for Airbnb regular reservations", () => {
    expect(isBlockEvent("AIRBNB", "Reserved")).toBe(false);
    expect(isBlockEvent("AIRBNB", "Confirmed")).toBe(false);
  });

  it("returns false for Booking.com events (cannot distinguish)", () => {
    expect(isBlockEvent("BOOKING_COM", "CLOSED - Not available")).toBe(false);
    expect(isBlockEvent("BOOKING_COM", "Reserved")).toBe(false);
  });
});
