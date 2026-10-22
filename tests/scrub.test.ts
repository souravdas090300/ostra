import { describe, it, expect } from "vitest";
import { scrub } from "../lib/scrub";

describe("scrub", () => {
  it("removes phone numbers with various formats", () => {
    expect(scrub("Call +356 7912 3456")).toBe("Call [number]");
    expect(scrub("00356 79123456")).toBe("[number]");
    expect(scrub("+1 (555) 123-4567")).toBe("[number]");
  });

  it("removes emails", () => {
    expect(scrub("Email test@example.com")).toBe("Email [email]");
    expect(scrub("user.name+tag@domain.co.uk")).toBe("[email]");
  });

  it("removes URLs with tokens", () => {
    expect(scrub("https://calendar.airbnb.com/rooms/123/ical?token=abc")).toBe("[url]");
    expect(scrub("http://example.com/path")).toBe("[url]");
  });

  it("removes long digit runs", () => {
    expect(scrub("Order 1234567890")).toBe("Order [number]");
    expect(scrub("ID 987654321")).toBe("ID [number]");
  });

  it("leaves short numbers", () => {
    expect(scrub("Meeting at 15:00")).toBe("Meeting at 15:00");
    expect(scrub("Code 120")).toBe("Code 120");
    expect(scrub("Floor 3")).toBe("Floor 3");
  });

  it("handles multiple sensitive items", () => {
    expect(scrub("Call +35679123456 or email test@example.com")).toBe("Call [number] or email [email]");
  });

  it("leaves text without sensitive data unchanged", () => {
    expect(scrub("Hello world")).toBe("Hello world");
    expect(scrub("The door code is under the mat")).toBe("The door code is under the mat");
  });
});
