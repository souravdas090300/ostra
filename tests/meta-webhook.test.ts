import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET, POST } from "@/app/api/webhooks/meta/route";

// Mock meta-whatsapp
vi.mock("@/lib/meta-whatsapp", () => ({
  verifyMetaWebhookSignature: vi.fn(),
}));

// Mock inbound
vi.mock("@/lib/inbound", () => ({
  processInbound: vi.fn(),
}));

// Mock meta-webhook
vi.mock("@/lib/meta-webhook", () => ({
  handleMetaPayload: vi.fn(),
}));

// Mock log
vi.mock("@/lib/log", () => ({
  log: vi.fn(),
}));

import { verifyMetaWebhookSignature } from "@/lib/meta-whatsapp";
import { processInbound } from "@/lib/inbound";
import { handleMetaPayload } from "@/lib/meta-webhook";

describe("meta webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("META_APP_SECRET", "test-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("META_APP_SECRET", "test-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("GET - subscription handshake", () => {
    it("returns 403 for missing verify token", () => {
      const request = new Request("http://localhost/api/webhooks/meta?hub.mode=subscribe&hub.challenge=test123");
      const response = GET(request);
      expect(response.status).toBe(403);
    });

    it("returns 403 for wrong verify token", () => {
      const request = new Request("http://localhost/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=test123");
      const response = GET(request);
      expect(response.status).toBe(403);
    });

    it("returns 200 with challenge for correct token", () => {
      vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "correct-token");
      const request = new Request("http://localhost/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=correct-token&hub.challenge=test123");
      const response = GET(request);
      expect(response.status).toBe(200);
      expect(response.status).toBe(200);
    });
  });

  describe("POST - webhook handler", () => {
    it("returns 403 for invalid signature", async () => {
      vi.mocked(verifyMetaWebhookSignature).mockReturnValue(false);

      const request = new Request("http://localhost/api/webhooks/meta", {
        method: "POST",
        headers: { "x-hub-signature-256": "invalid" },
        body: JSON.stringify({ entry: [] }),
      });

      const response = await POST(request);
      expect(response.status).toBe(403);
    });

    it("returns 200 for valid signature", async () => {
      vi.mocked(verifyMetaWebhookSignature).mockReturnValue(true);
      vi.mocked(handleMetaPayload).mockResolvedValue(undefined);

      const request = new Request("http://localhost/api/webhooks/meta", {
        method: "POST",
        headers: { "x-hub-signature-256": "valid" },
        body: JSON.stringify({ entry: [] }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it("processes text message", async () => {
      vi.mocked(verifyMetaWebhookSignature).mockReturnValue(true);
      vi.mocked(handleMetaPayload).mockResolvedValue(undefined);

      const payload = {
        entry: [{
          changes: [{
            field: "messages",
            value: {
              metadata: { phone_number_id: "123" },
              messages: [{
                id: "msg1",
                from: "35612345678",
                type: "text",
                text: { body: "Hello" },
              }],
            },
          }],
        }],
      };

      const request = new Request("http://localhost/api/webhooks/meta", {
        method: "POST",
        headers: { "x-hub-signature-256": "valid" },
        body: JSON.stringify(payload),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      expect(handleMetaPayload).toHaveBeenCalled();
    });

    it("handles processing errors gracefully", async () => {
      vi.mocked(verifyMetaWebhookSignature).mockReturnValue(true);
      vi.mocked(handleMetaPayload).mockRejectedValue(new Error("Test error"));

      const request = new Request("http://localhost/api/webhooks/meta", {
        method: "POST",
        headers: { "x-hub-signature-256": "valid" },
        body: JSON.stringify({ entry: [] }),
      });

      const response = await POST(request);
      // Should still return 200 to acknowledge receipt
      expect(response.status).toBe(200);
    });
  });
});
