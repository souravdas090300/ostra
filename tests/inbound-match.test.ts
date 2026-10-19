import { describe, it, expect } from "vitest";
import { chooseBooking, detailsUnlocked, MATCH_BEFORE_MS, MATCH_AFTER_MS, DETAILS_BEFORE_MS, DETAILS_AFTER_MS } from "../lib/inbound-match";

describe("chooseBooking", () => {
  const now = new Date("2026-10-31T12:00:00Z");

  it("matches booking within 3 days before check-in", () => {
    // A booking that starts 2 days before now and ends after now
    const checkIn = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const checkOut = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const cands = [{ id: "1", checkIn, checkOut }];
    const result = chooseBooking(cands, now);
    expect(result).not.toBeNull();
    expect(result?.booking.id).toBe("1");
  });

  it("matches booking within 1 day after check-out", () => {
    // A booking that ended 30 minutes ago
    const checkOut = new Date(now.getTime() - 30 * 60 * 1000);
    const checkIn = new Date(checkOut.getTime() - 24 * 60 * 60 * 1000);
    const cands = [{ id: "1", checkIn, checkOut }];
    const result = chooseBooking(cands, now);
    expect(result).not.toBeNull();
    expect(result?.booking.id).toBe("1");
  });

  it("does not match booking beyond 3 days before check-in", () => {
    const checkIn = new Date(now.getTime() - MATCH_BEFORE_MS - 60_000);
    const checkOut = new Date(checkIn.getTime() + 24 * 60 * 60 * 1000);
    const cands = [{ id: "1", checkIn, checkOut }];
    const result = chooseBooking(cands, now);
    expect(result).toBeNull();
  });

  it("does not match booking beyond 1 day after check-out", () => {
    // checkOut is more than 1 day ago (checkOut + 1 day < now)
    const checkOut = new Date(now.getTime() - MATCH_AFTER_MS - 60_000); // now - 1 day - 1 minute
    const checkIn = new Date(checkOut.getTime() - 24 * 60 * 60 * 1000);
    const cands = [{ id: "1", checkIn, checkOut }];
    const result = chooseBooking(cands, now);
    expect(result).toBeNull();
  });

  it("chooses in-house booking over future booking", () => {
    const inHouseCheckIn = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const inHouseCheckOut = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const futureCheckIn = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const futureCheckOut = new Date(futureCheckIn.getTime() + 24 * 60 * 60 * 1000);
    const cands = [
      { id: "future", checkIn: futureCheckIn, checkOut: futureCheckOut },
      { id: "inhouse", checkIn: inHouseCheckIn, checkOut: inHouseCheckOut },
    ];
    const result = chooseBooking(cands, now);
    expect(result?.booking.id).toBe("inhouse");
  });

  it("chooses nearest upcoming booking when none in-house", () => {
    const soonCheckIn = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const soonCheckOut = new Date(soonCheckIn.getTime() + 24 * 60 * 60 * 1000);
    const laterCheckIn = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const laterCheckOut = new Date(laterCheckIn.getTime() + 24 * 60 * 60 * 1000);
    const cands = [
      { id: "later", checkIn: laterCheckIn, checkOut: laterCheckOut },
      { id: "soon", checkIn: soonCheckIn, checkOut: soonCheckOut },
    ];
    const result = chooseBooking(cands, now);
    expect(result?.booking.id).toBe("soon");
  });

  it("chooses latest past stay when no in-house or upcoming", () => {
    // Past stays must still be within the 1-day-after-check-out window
    const recentCheckOut = new Date(now.getTime() - 60_000); // 1 minute ago (within window)
    const recentCheckIn = new Date(recentCheckOut.getTime() - 24 * 60 * 60 * 1000);
    const olderCheckOut = new Date(now.getTime() - 12 * 60 * 60 * 1000); // 12 hours ago (within window)
    const olderCheckIn = new Date(olderCheckOut.getTime() - 24 * 60 * 60 * 1000);
    const cands = [
      { id: "older", checkIn: olderCheckIn, checkOut: olderCheckOut },
      { id: "recent", checkIn: recentCheckIn, checkOut: recentCheckOut },
    ];
    const result = chooseBooking(cands, now);
    // The implementation sorts by checkOut descending, so the one with the latest checkOut should be chosen
    expect(result).not.toBeNull();
    expect(result?.booking.id).toBe("recent");
  });

  it("sets ambiguous flag when multiple bookings match", () => {
    const checkIn = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const checkOut = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const cands = [
      { id: "1", checkIn, checkOut },
      { id: "2", checkIn, checkOut },
    ];
    const result = chooseBooking(cands, now);
    expect(result?.ambiguous).toBe(true);
  });

  it("returns null when no bookings", () => {
    const result = chooseBooking([], now);
    expect(result).toBeNull();
  });
});

describe("detailsUnlocked", () => {
  const checkIn = new Date("2026-10-31T12:00:00Z");
  const checkOut = new Date("2026-11-03T12:00:00Z");
  const booking = { id: "1", checkIn, checkOut };

  it("is locked 25 hours before check-in", () => {
    const now = new Date(checkIn.getTime() - DETAILS_BEFORE_MS - 60_000);
    expect(detailsUnlocked(booking, now)).toBe(false);
  });

  it("is unlocked at 24 hours before check-in", () => {
    const now = new Date(checkIn.getTime() - DETAILS_BEFORE_MS);
    expect(detailsUnlocked(booking, now)).toBe(true);
  });

  it("is unlocked during the stay", () => {
    const now = new Date(checkIn.getTime() + 24 * 60 * 60 * 1000);
    expect(detailsUnlocked(booking, now)).toBe(true);
  });

  it("is still unlocked 23 hours after check-out", () => {
    const now = new Date(checkOut.getTime() + DETAILS_AFTER_MS - 60_000);
    expect(detailsUnlocked(booking, now)).toBe(true);
  });

  it("is locked after 24 hours after check-out", () => {
    const now = new Date(checkOut.getTime() + DETAILS_AFTER_MS + 60_000);
    expect(detailsUnlocked(booking, now)).toBe(false);
  });
});
