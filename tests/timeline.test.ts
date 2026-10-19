import { describe, it, expect } from "vitest";
import { assignLanes, barGeometry } from "../lib/timeline";
import type { Stay } from "../lib/conflicts";

const baseStay = (id: string, inYmd: string, outYmd: string): Pick<Stay, "id" | "inYmd" | "outYmd"> => ({
  id,
  inYmd,
  outYmd,
});

describe("timeline", () => {
  describe("assignLanes", () => {
    it("touching stays share a lane", () => {
      const stays = [
        baseStay("1", "2026-10-31", "2026-11-03"),
        baseStay("2", "2026-11-03", "2026-11-06"),
      ];
      const { lanes, laneCount } = assignLanes(stays);
      expect(laneCount).toBe(1);
      expect(lanes.get("1")).toBe(0);
      expect(lanes.get("2")).toBe(0);
    });

    it("overlapping stays use two lanes", () => {
      const stays = [
        baseStay("1", "2026-10-31", "2026-11-05"),
        baseStay("2", "2026-11-02", "2026-11-07"),
      ];
      const { lanes, laneCount } = assignLanes(stays);
      expect(laneCount).toBe(2);
      expect(lanes.get("1")).toBe(0);
      expect(lanes.get("2")).toBe(1);
    });

    it("laneCount is at least 1 with no stays", () => {
      const { laneCount } = assignLanes([]);
      expect(laneCount).toBe(1);
    });

    it("packs stays efficiently", () => {
      const stays = [
        baseStay("1", "2026-10-31", "2026-11-03"),
        baseStay("2", "2026-11-02", "2026-11-05"),
        baseStay("3", "2026-11-03", "2026-11-06"),
      ];
      const { lanes, laneCount } = assignLanes(stays);
      expect(laneCount).toBe(2);
      expect(lanes.get("1")).toBe(0);
      expect(lanes.get("2")).toBe(1);
      expect(lanes.get("3")).toBe(0); // reuses lane 0 after stay 1 ends
    });
  });

  describe("barGeometry", () => {
    it("positions stay inside the window", () => {
      const stay = baseStay("1", "2026-11-02", "2026-11-05");
      const geo = barGeometry(stay, "2026-11-01", 7);
      expect(geo).not.toBeNull();
      expect(geo!.left).toBe(1.5); // starts at middle of day 1 (Nov 2)
      expect(geo!.width).toBe(3); // ends at middle of day 4 (Nov 5)
      expect(geo!.continuesLeft).toBe(false);
      expect(geo!.continuesRight).toBe(false);
    });

    it("handles stay checking out on the first visible day", () => {
      const stay = baseStay("1", "2026-10-29", "2026-11-01");
      const geo = barGeometry(stay, "2026-11-01", 7);
      expect(geo).not.toBeNull();
      expect(geo!.left).toBe(0);
      expect(geo!.width).toBe(0.5);
      expect(geo!.continuesLeft).toBe(true);
      expect(geo!.continuesRight).toBe(false);
    });

    it("handles stay starting on the last visible day", () => {
      const stay = baseStay("1", "2026-11-07", "2026-11-10");
      const geo = barGeometry(stay, "2026-11-01", 7);
      expect(geo).not.toBeNull();
      expect(geo!.left).toBe(6.5); // starts at middle of day 6 (Nov 7)
      expect(geo!.width).toBe(0.5);
      expect(geo!.continuesLeft).toBe(false);
      expect(geo!.continuesRight).toBe(true);
    });

    it("handles stay starting before the window", () => {
      const stay = baseStay("1", "2026-10-29", "2026-11-05");
      const geo = barGeometry(stay, "2026-11-01", 7);
      expect(geo).not.toBeNull();
      expect(geo!.left).toBe(0);
      expect(geo!.width).toBe(4.5); // ends at middle of day 4 (Nov 5)
      expect(geo!.continuesLeft).toBe(true);
      expect(geo!.continuesRight).toBe(false);
    });

    it("handles stay ending after the window", () => {
      const stay = baseStay("1", "2026-11-03", "2026-11-10");
      const geo = barGeometry(stay, "2026-11-01", 7);
      expect(geo).not.toBeNull();
      expect(geo!.left).toBe(2.5); // starts at middle of day 2 (Nov 3)
      expect(geo!.width).toBe(4.5); // clipped to end of window
      expect(geo!.continuesLeft).toBe(false);
      expect(geo!.continuesRight).toBe(true);
    });

    it("returns null for stay fully outside the window (before)", () => {
      const stay = baseStay("1", "2026-10-25", "2026-10-30");
      const geo = barGeometry(stay, "2026-11-01", 7);
      expect(geo).toBeNull();
    });

    it("returns null for stay fully outside the window (after)", () => {
      const stay = baseStay("1", "2026-11-10", "2026-11-15");
      const geo = barGeometry(stay, "2026-11-01", 7);
      expect(geo).toBeNull();
    });

    it("returns null for stay ending on from - 1", () => {
      const stay = baseStay("1", "2026-10-28", "2026-10-31");
      const geo = barGeometry(stay, "2026-11-01", 7);
      expect(geo).toBeNull();
    });
  });
});
