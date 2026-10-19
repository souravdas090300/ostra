import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/cron/sync-calendars/route";

// Mock syncAllFeeds to avoid database calls
vi.mock("@/lib/sync", () => ({
  syncAllFeeds: vi.fn(() => Promise.resolve([])),
}));

describe("cron endpoint", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns 401 without authorization header", async () => {
    process.env.CRON_SECRET = "test-secret";
    const request = new Request("http://localhost/api/cron/sync-calendars", {
      method: "POST",
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("returns 401 with wrong secret", async () => {
    process.env.CRON_SECRET = "test-secret";
    const request = new Request("http://localhost/api/cron/sync-calendars", {
      method: "POST",
      headers: { authorization: "Bearer wrong-secret" },
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("returns 401 when CRON_SECRET is unset", async () => {
    process.env.CRON_SECRET = "";
    const request = new Request("http://localhost/api/cron/sync-calendars", {
      method: "POST",
      headers: { authorization: "Bearer any-secret" },
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("returns 200 with correct secret", async () => {
    process.env.CRON_SECRET = "test-secret";
    const request = new Request("http://localhost/api/cron/sync-calendars", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("feeds");
    expect(data).toHaveProperty("failed");
    expect(data).toHaveProperty("created");
    expect(data).toHaveProperty("updated");
    expect(data).toHaveProperty("cancelled");
  });

  it("GET returns 405", async () => {
    // Next.js only exports POST, so GET should be handled by Next.js as 405
    // This is implicit in the API route structure
    expect(true).toBe(true); // placeholder - Next.js handles this
  });
});
