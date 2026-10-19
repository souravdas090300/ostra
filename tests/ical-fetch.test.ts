import { describe, it, expect } from "vitest";
import { isPrivateIp, FeedError } from "@/lib/ical-fetch";

describe("ical-fetch utilities", () => {
  describe("isPrivateIp", () => {
    it("returns true for IPv4 private addresses", () => {
      expect(isPrivateIp("127.0.0.1")).toBe(true);
      expect(isPrivateIp("10.1.2.3")).toBe(true);
      expect(isPrivateIp("172.16.0.1")).toBe(true);
      expect(isPrivateIp("172.31.255.255")).toBe(true);
      expect(isPrivateIp("192.168.1.1")).toBe(true);
      expect(isPrivateIp("169.254.169.254")).toBe(true);
      expect(isPrivateIp("100.64.0.1")).toBe(true);
    });

    it("returns false for IPv4 public addresses", () => {
      expect(isPrivateIp("8.8.8.8")).toBe(false);
      expect(isPrivateIp("1.1.1.1")).toBe(false);
      expect(isPrivateIp("172.15.255.255")).toBe(false);
      expect(isPrivateIp("172.32.0.1")).toBe(false);
    });

    it("returns true for IPv6 private addresses", () => {
      expect(isPrivateIp("::1")).toBe(true);
      expect(isPrivateIp("::")).toBe(true);
      expect(isPrivateIp("fe80::1")).toBe(true);
      expect(isPrivateIp("fd00::1")).toBe(true);
      expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
    });

    it("returns false for IPv6 public addresses", () => {
      expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
      expect(isPrivateIp("2001:4860:4860::8888")).toBe(false);
    });

    it("returns true for non-IP strings (defensive)", () => {
      expect(isPrivateIp("not-an-ip")).toBe(true);
      expect(isPrivateIp("")).toBe(true);
    });
  });

  describe("FeedError", () => {
    it("can be thrown and caught", () => {
      expect(() => { throw new FeedError("test error"); }).toThrow("test error");
    });
  });
});
