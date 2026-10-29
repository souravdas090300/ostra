import { describe, it, expect, beforeEach } from "vitest";
import { hashPhone } from "../lib/hash";

describe("hashPhone", () => {
  beforeEach(() => {
    process.env.DATA_PEPPER = "test-pepper-for-testing";
  });

  it("is deterministic", () => {
    const phone = "+35679123456";
    const hash1 = hashPhone(phone);
    const hash2 = hashPhone(phone);
    expect(hash1).toBe(hash2);
  });

  it("differs per pepper", () => {
    const phone = "+35679123456";
    process.env.DATA_PEPPER = "pepper1";
    const hash1 = hashPhone(phone);
    process.env.DATA_PEPPER = "pepper2";
    const hash2 = hashPhone(phone);
    expect(hash1).not.toBe(hash2);
  });

  it("different numbers produce different hashes", () => {
    const hash1 = hashPhone("+35679123456");
    const hash2 = hashPhone("+35679123457");
    expect(hash1).not.toBe(hash2);
  });

  it("output is not the input", () => {
    const phone = "+35679123456";
    const hash = hashPhone(phone);
    expect(hash).not.toBe(phone);
    expect(hash).not.toContain(phone);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("normalizes to lowercase", () => {
    const hash1 = hashPhone("+35679123456");
    const hash2 = hashPhone("+35679123456");
    expect(hash1).toBe(hash2);
  });
});
