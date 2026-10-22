import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { log } from "../lib/log";

describe("log", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps allowed fields", () => {
    log("info", "test", { bookingId: "123", count: 5 });
    expect(console.info).toHaveBeenCalled();
    const output = JSON.parse((console.info as any).mock.calls[0][0]);
    expect(output.bookingId).toBe("123");
    expect(output.count).toBe(5);
  });

  it("drops unknown fields", () => {
    log("info", "test", { body: "secret", phone: "+123" });
    expect(console.info).toHaveBeenCalled();
    const output = JSON.parse((console.info as any).mock.calls[0][0]);
    expect(output.body).toBeUndefined();
    expect(output.phone).toBeUndefined();
  });

  it("scrubs string values", () => {
    log("info", "test", { bookingId: "+35679123456" });
    expect(console.info).toHaveBeenCalled();
    const output = JSON.parse((console.info as any).mock.calls[0][0]);
    expect(output.bookingId).toBe("[number]");
  });

  it("truncates long strings", () => {
    const longString = "a".repeat(300);
    log("info", "test", { bookingId: longString });
    expect(console.info).toHaveBeenCalled();
    const output = JSON.parse((console.info as any).mock.calls[0][0]);
    expect(output.bookingId.length).toBeLessThanOrEqual(200);
  });

  it("keeps non-string values unchanged", () => {
    log("info", "test", { count: 123, status: "ok" });
    expect(console.info).toHaveBeenCalled();
    const output = JSON.parse((console.info as any).mock.calls[0][0]);
    expect(output.count).toBe(123);
    expect(output.status).toBe("ok");
  });

  it("supports different log levels", () => {
    log("warn", "test", { count: 1 });
    expect(console.warn).toHaveBeenCalled();

    log("error", "test", { count: 1 });
    expect(console.error).toHaveBeenCalled();
  });

  it("includes timestamp and event", () => {
    log("info", "my_event", { count: 1 });
    expect(console.info).toHaveBeenCalled();
    const output = JSON.parse((console.info as any).mock.calls[0][0]);
    expect(output.t).toBeDefined();
    expect(output.level).toBe("info");
    expect(output.event).toBe("my_event");
  });
});
