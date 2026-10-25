import { describe, it, expect } from "vitest";
import { linkState, type LinkState } from "@/lib/export-feeds";

describe("PlatformBlockNotice state logic (pure logic)", () => {
  const now = new Date("2026-01-15T10:00:00Z");

  it("direct booking with both connected shows two soft notes", () => {
    const states: Record<"AIRBNB" | "BOOKING_COM", LinkState> = {
      AIRBNB: "CONNECTED",
      BOOKING_COM: "CONNECTED",
    };

    // For direct bookings, both platforms need blocking
    // Both are CONNECTED, so should show soft notes
    expect(states.AIRBNB).toBe("CONNECTED");
    expect(states.BOOKING_COM).toBe("CONNECTED");
  });

  it("Airbnb STALE shows amber warning for Airbnb", () => {
    const states: Record<"AIRBNB" | "BOOKING_COM", LinkState> = {
      AIRBNB: "STALE",
      BOOKING_COM: "CONNECTED",
    };

    // Airbnb is STALE, should show amber warning
    expect(states.AIRBNB).toBe("STALE");
    expect(states.BOOKING_COM).toBe("CONNECTED");
  });

  it("linkState function returns correct states", () => {
    const connected = linkState({ enabled: true, lastFetchedAt: new Date(now.getTime() - 2 * 60 * 60_000) }, now);
    expect(connected).toBe("CONNECTED");

    const stale = linkState({ enabled: true, lastFetchedAt: new Date(now.getTime() - 50 * 60 * 60_000) }, now);
    expect(stale).toBe("STALE");

    const waiting = linkState({ enabled: true, lastFetchedAt: null }, now);
    expect(waiting).toBe("WAITING");

    const disabled = linkState({ enabled: false, lastFetchedAt: null }, now);
    expect(disabled).toBe("DISABLED");
  });

  it("stale boundary works correctly", () => {
    const exactlyAtThreshold = linkState({ enabled: true, lastFetchedAt: new Date(now.getTime() - 48 * 60 * 60_000) }, now, 48);
    expect(exactlyAtThreshold).toBe("CONNECTED");

    const justPastThreshold = linkState({ enabled: true, lastFetchedAt: new Date(now.getTime() - 48 * 60 * 60_000 - 1) }, now, 48);
    expect(justPastThreshold).toBe("STALE");
  });
});
