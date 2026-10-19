import { describe, it, expect } from "vitest";
import { unsupportedContacts, isStopKeyword } from "../lib/guards";

describe("unsupportedContacts", () => {
  it("blocks unknown link", () => {
    const reply = "Check this: https://malicious.com";
    const allowed = "Welcome to our apartment. Check the guide at https://example.com/guide";
    expect(unsupportedContacts(reply, allowed)).toBe("link");
  });

  it("allows known link", () => {
    const reply = "Here is the guide: https://example.com/guide";
    const allowed = "Guide: https://example.com/guide";
    expect(unsupportedContacts(reply, allowed)).toBeNull();
  });

  it("ignores trailing punctuation in links", () => {
    const reply = "See https://example.com/guide.";
    const allowed = "https://example.com/guide";
    expect(unsupportedContacts(reply, allowed)).toBeNull();
  });

  it("is case-insensitive for links", () => {
    const reply = "See HTTPS://EXAMPLE.COM/GUIDE";
    const allowed = "https://example.com/guide";
    expect(unsupportedContacts(reply, allowed)).toBeNull();
  });

  it("blocks invented phone number", () => {
    const reply = "Call me at +1234567890";
    const allowed = "Emergency: +356 7912 3456";
    expect(unsupportedContacts(reply, allowed)).toBe("number");
  });

  it("allows number present in info", () => {
    const reply = "Emergency: +356 7912 3456";
    const allowed = "Emergency contact: +356 7912 3456";
    expect(unsupportedContacts(reply, allowed)).toBeNull();
  });

  it("does not false positive for date '5 November 2026 at 15:00'", () => {
    const reply = "We arrive on 5 November 2026 at 15:00";
    const allowed = "Check-in at 14:00";
    expect(unsupportedContacts(reply, allowed)).toBeNull();
  });

  it("does not false positive for price '120 EUR'", () => {
    const reply = "The price is 120 EUR";
    const allowed = "Cleaning fee: 50 EUR";
    expect(unsupportedContacts(reply, allowed)).toBeNull();
  });

  it("does not false positive for 4-digit door code", () => {
    const reply = "The code is 4821#";
    const allowed = "Door code: 4821#";
    expect(unsupportedContacts(reply, allowed)).toBeNull();
  });

  it("does not false positive for 'Wi-Fi Seaview!2026'", () => {
    const reply = "Wi-Fi: Seaview!2026";
    const allowed = "Wi-Fi name: Seaview!2026";
    expect(unsupportedContacts(reply, allowed)).toBeNull();
  });
});

describe("isStopKeyword", () => {
  it("returns true for STOP", () => {
    expect(isStopKeyword("STOP")).toBe(true);
  });

  it("returns true for stop with punctuation", () => {
    expect(isStopKeyword("stop.")).toBe(true);
    expect(isStopKeyword("Stop!")).toBe(true);
  });

  it("returns true for unsubscribe", () => {
    expect(isStopKeyword("unsubscribe")).toBe(true);
  });

  it("returns true for stop all", () => {
    expect(isStopKeyword("stop all")).toBe(true);
  });

  it("returns true for stop messages", () => {
    expect(isStopKeyword("stop messages")).toBe(true);
  });

  it("returns false for 'please stop by the shop'", () => {
    expect(isStopKeyword("please stop by the shop")).toBe(false);
  });

  it("returns false for 'non-stop'", () => {
    expect(isStopKeyword("non-stop")).toBe(false);
  });

  it("returns false for 'cancel'", () => {
    expect(isStopKeyword("cancel")).toBe(false);
  });

  it("returns false for empty text", () => {
    expect(isStopKeyword("")).toBe(false);
  });
});
