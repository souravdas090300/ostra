import { describe, it, expect } from "vitest";
import { newExportToken, linkState, type LinkState } from "@/lib/export-feeds";

describe("export-feeds", () => {
  describe("newExportToken", () => {
    it("generates token of length 32", () => {
      const token = newExportToken();
      expect(token).toHaveLength(32);
    });

    it("uses base64url alphabet", () => {
      const token = newExportToken();
      const base64urlRegex = /^[A-Za-z0-9_-]+$/;
      expect(base64urlRegex.test(token)).toBe(true);
    });

    it("1000 tokens are unique", () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        tokens.add(newExportToken());
      }
      expect(tokens.size).toBe(1000);
    });
  });

  describe("linkState", () => {
    const now = new Date("2026-01-15T10:00:00Z");

    it("DISABLED when enabled is false", () => {
      const state = linkState({ enabled: false, lastFetchedAt: null }, now);
      expect(state).toBe("DISABLED");
    });

    it("WAITING when enabled is true and lastFetchedAt is null", () => {
      const state = linkState({ enabled: true, lastFetchedAt: null }, now);
      expect(state).toBe("WAITING");
    });

    it("CONNECTED when last fetch was recent", () => {
      const lastFetchedAt = new Date(now.getTime() - 2 * 60 * 60_000); // 2 hours ago
      const state = linkState({ enabled: true, lastFetchedAt }, now, 48);
      expect(state).toBe("CONNECTED");
    });

    it("STALE when last fetch was beyond stale threshold", () => {
      const lastFetchedAt = new Date(now.getTime() - 50 * 60 * 60_000); // 50 hours ago
      const state = linkState({ enabled: true, lastFetchedAt }, now, 48);
      expect(state).toBe("STALE");
    });

    it("exact stale boundary - CONNECTED at exactly threshold", () => {
      const lastFetchedAt = new Date(now.getTime() - 48 * 60 * 60_000); // exactly 48 hours ago
      const state = linkState({ enabled: true, lastFetchedAt }, now, 48);
      expect(state).toBe("CONNECTED");
    });

    it("STALE one millisecond past threshold", () => {
      const lastFetchedAt = new Date(now.getTime() - 48 * 60 * 60_000 - 1); // 48 hours + 1ms ago
      const state = linkState({ enabled: true, lastFetchedAt }, now, 48);
      expect(state).toBe("STALE");
    });

    it("custom staleHours parameter", () => {
      const lastFetchedAt = new Date(now.getTime() - 25 * 60 * 60_000); // 25 hours ago
      const state = linkState({ enabled: true, lastFetchedAt }, now, 24);
      expect(state).toBe("STALE");
    });

    it("all four states can be reached", () => {
      const disabled = linkState({ enabled: false, lastFetchedAt: null }, now);
      expect(disabled).toBe("DISABLED");

      const waiting = linkState({ enabled: true, lastFetchedAt: null }, now);
      expect(waiting).toBe("WAITING");

      const connected = linkState({ enabled: true, lastFetchedAt: new Date(now.getTime() - 1 * 60 * 60_000) }, now);
      expect(connected).toBe("CONNECTED");

      const stale = linkState({ enabled: true, lastFetchedAt: new Date(now.getTime() - 100 * 60 * 60_000) }, now);
      expect(stale).toBe("STALE");
    });
  });
});
