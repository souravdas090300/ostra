import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET, POST } from "@/app/api/cron/tick/route";

const { cronAuthorizedMock, runTickMock } = vi.hoisted(() => ({
  cronAuthorizedMock: vi.fn(),
  runTickMock: vi.fn(),
}));

vi.mock("@/lib/cron-auth", () => ({
  cronAuthorized: cronAuthorizedMock,
  requireCronAuth: vi.fn((req: Request) =>
    cronAuthorizedMock(req)
      ? null
      : new Response("Unauthorized", { status: 401 })
  ),
}));

vi.mock("@/lib/scheduler", () => ({
  runTick: runTickMock,
}));

describe("/api/cron/tick", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    runTickMock.mockResolvedValue({ ran: ["send-scheduled"], skipped: 2, failed: 0 });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns 401 on GET without authorization", async () => {
    cronAuthorizedMock.mockReturnValue(false);
    const res = await GET(new Request("http://localhost/api/cron/tick"));
    expect(res.status).toBe(401);
    expect(runTickMock).not.toHaveBeenCalled();
  });

  it("returns 401 on POST without authorization", async () => {
    cronAuthorizedMock.mockReturnValue(false);
    const res = await POST(
      new Request("http://localhost/api/cron/tick", { method: "POST" })
    );
    expect(res.status).toBe(401);
    expect(runTickMock).not.toHaveBeenCalled();
  });

  it("GET returns names and counts only when authorized", async () => {
    cronAuthorizedMock.mockReturnValue(true);
    const res = await GET(new Request("http://localhost/api/cron/tick"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ran: ["send-scheduled"], skipped: 2, failed: 0 });
  });

  it("POST returns names and counts only when authorized", async () => {
    cronAuthorizedMock.mockReturnValue(true);
    const res = await POST(
      new Request("http://localhost/api/cron/tick", { method: "POST" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ran: ["send-scheduled"], skipped: 2, failed: 0 });
  });
});
