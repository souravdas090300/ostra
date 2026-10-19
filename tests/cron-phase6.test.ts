import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as SendScheduledPOST } from "@/app/api/cron/send-scheduled/route";
import { POST as SyncTemplatesPOST } from "@/app/api/cron/sync-templates/route";

// Mock dependencies
vi.mock("@/lib/send-scheduled", () => ({
  sendDueMessages: vi.fn(),
}));

vi.mock("@/lib/template-approval", () => ({
  syncApprovals: vi.fn(),
}));

vi.mock("@/lib/cron-auth", () => ({
  cronAuthorized: vi.fn(),
}));

import { sendDueMessages } from "@/lib/send-scheduled";
import { syncApprovals } from "@/lib/template-approval";
import { cronAuthorized } from "@/lib/cron-auth";

describe("cron endpoints (Phase 6)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = originalEnv;
  });

  describe("send-scheduled endpoint", () => {
    it("returns 401 without authorization", async () => {
      process.env.CRON_SECRET = "test-secret";
      vi.mocked(cronAuthorized).mockReturnValue(false);

      const request = new Request("http://localhost/api/cron/send-scheduled", {
        method: "POST",
      });

      const response = await SendScheduledPOST(request);
      expect(response.status).toBe(401);
    });

    it("returns 401 with wrong secret", async () => {
      process.env.CRON_SECRET = "test-secret";
      vi.mocked(cronAuthorized).mockReturnValue(false);

      const request = new Request("http://localhost/api/cron/send-scheduled", {
        method: "POST",
        headers: { authorization: "Bearer wrong-secret" },
      });

      const response = await SendScheduledPOST(request);
      expect(response.status).toBe(401);
    });

    it("returns 401 when CRON_SECRET is unset", async () => {
      process.env.CRON_SECRET = "";
      vi.mocked(cronAuthorized).mockReturnValue(false);

      const request = new Request("http://localhost/api/cron/send-scheduled", {
        method: "POST",
        headers: { authorization: "Bearer any-secret" },
      });

      const response = await SendScheduledPOST(request);
      expect(response.status).toBe(401);
    });

    it("returns summary with correct secret", async () => {
      process.env.CRON_SECRET = "test-secret";
      vi.mocked(cronAuthorized).mockReturnValue(true);
      vi.mocked(sendDueMessages).mockResolvedValue({
        claimed: 5,
        sent: 3,
        skipped: 1,
        failed: 1,
        retried: 0,
      });

      const request = new Request("http://localhost/api/cron/send-scheduled", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
      });

      const response = await SendScheduledPOST(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toEqual({
        claimed: 5,
        sent: 3,
        skipped: 1,
        failed: 1,
        retried: 0,
      });
    });
  });

  describe("sync-templates endpoint", () => {
    it("returns 401 without authorization", async () => {
      process.env.CRON_SECRET = "test-secret";
      vi.mocked(cronAuthorized).mockReturnValue(false);

      const request = new Request("http://localhost/api/cron/sync-templates", {
        method: "POST",
      });

      const response = await SyncTemplatesPOST(request);
      expect(response.status).toBe(401);
    });

    it("returns 200 with correct secret", async () => {
      process.env.CRON_SECRET = "test-secret";
      vi.mocked(cronAuthorized).mockReturnValue(true);
      vi.mocked(syncApprovals).mockResolvedValue();

      const request = new Request("http://localhost/api/cron/sync-templates", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
      });

      const response = await SyncTemplatesPOST(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toEqual({ success: true });
    });
  });
});
