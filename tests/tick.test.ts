import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST, GET } from "@/app/api/cron/tick/route";

// Mock dependencies
vi.mock("@/lib/jobs", () => ({
  JOBS: [
    { name: "test-job-1", every: 5, run: vi.fn() },
    { name: "test-job-2", every: 10, run: vi.fn() },
  ],
}));

vi.mock("@/lib/job-run", () => ({
  withJobRun: vi.fn(),
}));

vi.mock("@/lib/scheduler", () => ({
  isDue: vi.fn(),
  claimLease: vi.fn(),
  releaseLease: vi.fn(),
  getLastStartTimes: vi.fn(),
  sendHeartbeat: vi.fn(),
  getMaxDuration: vi.fn(() => 10),
}));

vi.mock("@/lib/cron-auth", () => ({
  requireCronAuth: vi.fn(),
}));

import { JOBS } from "@/lib/jobs";
import { withJobRun } from "@/lib/job-run";
import { isDue, claimLease, releaseLease, getLastStartTimes, sendHeartbeat } from "@/lib/scheduler";
import { requireCronAuth } from "@/lib/cron-auth";

describe("tick endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCronAuth).mockReturnValue(null);
    vi.mocked(getLastStartTimes).mockResolvedValue({});
    vi.mocked(isDue).mockReturnValue(true);
    vi.mocked(claimLease).mockResolvedValue(true);
    vi.mocked(releaseLease).mockResolvedValue();
    vi.mocked(sendHeartbeat).mockResolvedValue();
    vi.mocked(withJobRun).mockImplementation(async (job, fn) => {
      return await fn();
    });
    vi.mocked(JOBS[0].run).mockResolvedValue({ count: 1 });
    vi.mocked(JOBS[1].run).mockResolvedValue({ count: 2 });
  });

  it("POST returns 401 for unauthorized requests", async () => {
    vi.mocked(requireCronAuth).mockReturnValue(new Response("Unauthorized", { status: 401 }));

    const request = new Request("http://localhost/api/cron/tick", { method: "POST" });
    const response = await POST(request);

    expect(response.status).toBe(401);
  });

  it("GET returns 401 for unauthorized requests", async () => {
    vi.mocked(requireCronAuth).mockReturnValue(new Response("Unauthorized", { status: 401 }));

    const request = new Request("http://localhost/api/cron/tick", { method: "GET" });
    const response = await GET(request);

    expect(response.status).toBe(401);
  });

  it("POST runs due jobs", async () => {
    const request = new Request("http://localhost/api/cron/tick", { method: "POST" });
    const response = await POST(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ran).toEqual(["test-job-1", "test-job-2"]);
    expect(data.skipped).toBe(0);
    expect(data.failed).toBe(0);
  });

  it("GET runs due jobs", async () => {
    const request = new Request("http://localhost/api/cron/tick", { method: "GET" });
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ran).toEqual(["test-job-1", "test-job-2"]);
  });

  it("skips jobs that are not due", async () => {
    vi.mocked(isDue).mockImplementation((job) => job.name === "test-job-1");

    const request = new Request("http://localhost/api/cron/tick", { method: "POST" });
    const response = await POST(request);

    const data = await response.json();
    expect(data.ran).toEqual(["test-job-1"]);
    expect(data.skipped).toBe(0);
  });

  it("skips jobs when lease is held by another runner", async () => {
    vi.mocked(claimLease).mockImplementation(async (job) => job === "test-job-1");

    const request = new Request("http://localhost/api/cron/tick", { method: "POST" });
    const response = await POST(request);

    const data = await response.json();
    expect(data.ran).toEqual(["test-job-1"]);
    expect(data.skipped).toBe(1);
  });

  it("records failed jobs and continues with others", async () => {
    vi.mocked(JOBS[0].run).mockRejectedValue(new Error("Test error"));

    const request = new Request("http://localhost/api/cron/tick", { method: "POST" });
    const response = await POST(request);

    const data = await response.json();
    expect(data.ran).toEqual(["test-job-2"]);
    expect(data.failed).toBe(1);
  });

  it("releases lease even when job fails", async () => {
    vi.mocked(JOBS[0].run).mockRejectedValue(new Error("Test error"));

    const request = new Request("http://localhost/api/cron/tick", { method: "POST" });
    await POST(request);

    expect(releaseLease).toHaveBeenCalledWith("test-job-1");
    expect(releaseLease).toHaveBeenCalledWith("test-job-2");
  });

  it("sends heartbeat for each job", async () => {
    const request = new Request("http://localhost/api/cron/tick", { method: "POST" });
    await POST(request);

    expect(sendHeartbeat).toHaveBeenCalledWith("test-job-1");
    expect(sendHeartbeat).toHaveBeenCalledWith("test-job-2");
  });
});
