import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@sentry/nextjs", () => ({ init: vi.fn() }));

const { runTickMock } = vi.hoisted(() => ({
  runTickMock: vi.fn(async () => ({ ran: [], skipped: 0, failed: 0 })),
}));

vi.mock("@/lib/scheduler", () => ({
  runTick: runTickMock,
}));

import { register } from "@/instrumentation";

const g = globalThis as { __ostraSchedulerRegistered?: boolean };

describe("in-process scheduler driver (instrumentation.register)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    delete g.__ostraSchedulerRegistered;
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("does nothing when ENABLE_IN_PROCESS_SCHEDULER is not set", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.ENABLE_IN_PROCESS_SCHEDULER;
    const spy = vi.spyOn(globalThis, "setInterval");
    await register();
    expect(spy).not.toHaveBeenCalled();
  });

  it("does nothing outside the nodejs runtime", async () => {
    process.env.NEXT_RUNTIME = "edge";
    process.env.ENABLE_IN_PROCESS_SCHEDULER = "1";
    const spy = vi.spyOn(globalThis, "setInterval");
    await register();
    expect(spy).not.toHaveBeenCalled();
  });

  it("registers a 60s interval when enabled on nodejs", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.ENABLE_IN_PROCESS_SCHEDULER = "1";
    const spy = vi.spyOn(globalThis, "setInterval");
    await register();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.any(Function), 60_000);
  });

  it("registers only once across repeated calls (dev double-invoke)", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.ENABLE_IN_PROCESS_SCHEDULER = "1";
    const spy = vi.spyOn(globalThis, "setInterval");
    await register();
    await register();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
