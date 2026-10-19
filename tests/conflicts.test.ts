import { describe, it, expect } from "vitest";
import {
  findDoubleBookings,
  findTurnovers,
  findMissingContacts,
  daySummary,
  type Stay,
} from "../lib/conflicts";

const baseStay = (id: string, apt: string, inYmd: string, outYmd: string): Stay => ({
  id,
  apartmentId: apt,
  source: "AIRBNB",
  isBlock: false,
  inYmd,
  outYmd,
  checkIn: new Date(`${inYmd}T15:00:00Z`),
  checkOut: new Date(`${outYmd}T11:00:00Z`),
  guestName: "Test Guest",
  guestPhone: "+356 1234 5678",
});

describe("conflicts", () => {
  describe("findDoubleBookings", () => {
    it("finds overlap by one night", () => {
      const stays = [
        baseStay("1", "apt-1", "2026-10-31", "2026-11-03"),
        baseStay("2", "apt-1", "2026-11-02", "2026-11-05"),
      ];
      const doubles = findDoubleBookings(stays);
      expect(doubles).toHaveLength(1);
      expect(doubles[0].overlapFrom).toBe("2026-11-02");
      expect(doubles[0].overlapTo).toBe("2026-11-03");
    });

    it("does not flag back-to-back stays", () => {
      const stays = [
        baseStay("1", "apt-1", "2026-10-31", "2026-11-03"),
        baseStay("2", "apt-1", "2026-11-03", "2026-11-06"),
      ];
      const doubles = findDoubleBookings(stays);
      expect(doubles).toHaveLength(0);
    });

    it("finds identical dates", () => {
      const stays = [
        baseStay("1", "apt-1", "2026-10-31", "2026-11-03"),
        baseStay("2", "apt-1", "2026-10-31", "2026-11-03"),
      ];
      const doubles = findDoubleBookings(stays);
      expect(doubles).toHaveLength(1);
    });

    it("finds three mutually overlapping stays (three pairs)", () => {
      const stays = [
        baseStay("1", "apt-1", "2026-10-31", "2026-11-05"),
        baseStay("2", "apt-1", "2026-11-02", "2026-11-07"),
        baseStay("3", "apt-1", "2026-11-03", "2026-11-06"),
      ];
      const doubles = findDoubleBookings(stays);
      expect(doubles).toHaveLength(3);
    });

    it("finds a stay containing another", () => {
      const stays = [
        baseStay("1", "apt-1", "2026-10-31", "2026-11-07"),
        baseStay("2", "apt-1", "2026-11-02", "2026-11-05"),
      ];
      const doubles = findDoubleBookings(stays);
      expect(doubles).toHaveLength(1);
      expect(doubles[0].overlapFrom).toBe("2026-11-02");
      expect(doubles[0].overlapTo).toBe("2026-11-05");
    });

    it("does not conflict across different apartments", () => {
      const stays = [
        baseStay("1", "apt-1", "2026-10-31", "2026-11-03"),
        baseStay("2", "apt-2", "2026-11-02", "2026-11-05"),
      ];
      const doubles = findDoubleBookings(stays);
      expect(doubles).toHaveLength(0);
    });

    it("blocks never conflict (block over booking)", () => {
      const stays = [
        { ...baseStay("1", "apt-1", "2026-10-31", "2026-11-03"), isBlock: true },
        baseStay("2", "apt-1", "2026-11-02", "2026-11-05"),
      ];
      const doubles = findDoubleBookings(stays);
      expect(doubles).toHaveLength(0);
    });

    it("blocks never conflict (block over block)", () => {
      const stays = [
        { ...baseStay("1", "apt-1", "2026-10-31", "2026-11-03"), isBlock: true },
        { ...baseStay("2", "apt-1", "2026-11-02", "2026-11-05"), isBlock: true },
      ];
      const doubles = findDoubleBookings(stays);
      expect(doubles).toHaveLength(0);
    });

    it("overlap range is correct", () => {
      const stays = [
        baseStay("1", "apt-1", "2026-10-31", "2026-11-07"),
        baseStay("2", "apt-1", "2026-11-03", "2026-11-05"),
      ];
      const doubles = findDoubleBookings(stays);
      expect(doubles[0].overlapFrom).toBe("2026-11-03");
      expect(doubles[0].overlapTo).toBe("2026-11-05");
    });
  });

  describe("findTurnovers", () => {
    it("detects same-day turnover with correct gap hours", () => {
      const stays = [
        {
          ...baseStay("1", "apt-1", "2026-10-31", "2026-11-03"),
          checkOut: new Date("2026-11-03T11:00:00Z"),
        },
        {
          ...baseStay("2", "apt-1", "2026-11-03", "2026-11-06"),
          checkIn: new Date("2026-11-03T15:00:00Z"),
        },
      ];
      const turnovers = findTurnovers(stays);
      expect(turnovers).toHaveLength(1);
      expect(turnovers[0].gapHours).toBe(4);
    });

    it("flags tight turnover (below 3 hours)", () => {
      const stays = [
        {
          ...baseStay("1", "apt-1", "2026-10-31", "2026-11-03"),
          checkOut: new Date("2026-11-03T11:00:00Z"),
        },
        {
          ...baseStay("2", "apt-1", "2026-11-03", "2026-11-06"),
          checkIn: new Date("2026-11-03T13:30:00Z"),
        },
      ];
      const turnovers = findTurnovers(stays);
      expect(turnovers).toHaveLength(1);
      expect(turnovers[0].gapHours).toBe(2.5);
      expect(turnovers[0].tight).toBe(true);
    });

    it("does not flag turnovers across apartments", () => {
      const stays = [
        {
          ...baseStay("1", "apt-1", "2026-10-31", "2026-11-03"),
          checkOut: new Date("2026-11-03T11:00:00Z"),
        },
        {
          ...baseStay("2", "apt-2", "2026-11-03", "2026-11-06"),
          checkIn: new Date("2026-11-03T15:00:00Z"),
        },
      ];
      const turnovers = findTurnovers(stays);
      expect(turnovers).toHaveLength(0);
    });

    it("ignores blocks", () => {
      const stays = [
        {
          ...baseStay("1", "apt-1", "2026-10-31", "2026-11-03"),
          checkOut: new Date("2026-11-03T11:00:00Z"),
        },
        {
          ...baseStay("2", "apt-1", "2026-11-03", "2026-11-06"),
          checkIn: new Date("2026-11-03T15:00:00Z"),
          isBlock: true,
        },
      ];
      const turnovers = findTurnovers(stays);
      expect(turnovers).toHaveLength(0);
    });

    it("does not flag non-adjacent days", () => {
      const stays = [
        baseStay("1", "apt-1", "2026-10-31", "2026-11-03"),
        baseStay("2", "apt-1", "2026-11-04", "2026-11-07"),
      ];
      const turnovers = findTurnovers(stays);
      expect(turnovers).toHaveLength(0);
    });
  });

  describe("findMissingContacts", () => {
    it("includes arrivals today and in 7 days", () => {
      const stays = [
        { ...baseStay("1", "apt-1", "2026-10-31", "2026-11-03"), guestPhone: null },
        { ...baseStay("2", "apt-1", "2026-11-05", "2026-11-08"), guestPhone: null },
      ];
      const missing = findMissingContacts(stays, "2026-10-31", 7);
      expect(missing).toHaveLength(2);
    });

    it("excludes day 8", () => {
      const stays = [
        { ...baseStay("1", "apt-1", "2026-11-08", "2026-11-11"), guestPhone: null },
      ];
      const missing = findMissingContacts(stays, "2026-10-31", 7);
      expect(missing).toHaveLength(0);
    });

    it("excludes past arrivals", () => {
      const stays = [
        { ...baseStay("1", "apt-1", "2026-10-28", "2026-10-31"), guestPhone: null },
      ];
      const missing = findMissingContacts(stays, "2026-10-31", 7);
      expect(missing).toHaveLength(0);
    });

    it("excludes blocks", () => {
      const stays = [
        { ...baseStay("1", "apt-1", "2026-10-31", "2026-11-03"), guestPhone: null, isBlock: true },
      ];
      const missing = findMissingContacts(stays, "2026-10-31", 7);
      expect(missing).toHaveLength(0);
    });

    it("excludes bookings with a phone", () => {
      const stays = [
        baseStay("1", "apt-1", "2026-10-31", "2026-11-03"),
      ];
      const missing = findMissingContacts(stays, "2026-10-31", 7);
      expect(missing).toHaveLength(0);
    });
  });

  describe("daySummary", () => {
    it("counts arrivals, departures, and in-house correctly", () => {
      const stays = [
        baseStay("1", "apt-1", "2026-10-31", "2026-11-03"), // in-house on Nov 1
        baseStay("2", "apt-1", "2026-11-01", "2026-11-04"), // arrival on Nov 1
        baseStay("3", "apt-1", "2026-10-29", "2026-11-01"), // departure on Nov 1
      ];
      const summary = daySummary(stays, "2026-11-01");
      expect(summary.arrivals).toHaveLength(1);
      expect(summary.departures).toHaveLength(1);
      expect(summary.inHouse).toHaveLength(1);
    });

    it("does not count arrivals and departures of that day as in-house", () => {
      const stays = [
        baseStay("1", "apt-1", "2026-11-01", "2026-11-04"), // arrival on Nov 1
        baseStay("2", "apt-1", "2026-10-29", "2026-11-01"), // departure on Nov 1
      ];
      const summary = daySummary(stays, "2026-11-01");
      expect(summary.inHouse).toHaveLength(0);
    });

    it("identifies turnover apartments", () => {
      const stays = [
        baseStay("1", "apt-1", "2026-10-29", "2026-11-01"), // departure on Nov 1
        baseStay("2", "apt-1", "2026-11-01", "2026-11-04"), // arrival on Nov 1
      ];
      const summary = daySummary(stays, "2026-11-01");
      expect(summary.turnoverApartments.has("apt-1")).toBe(true);
    });
  });
});
