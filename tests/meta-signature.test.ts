import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.unmock("@/lib/meta-whatsapp");
import { verifyMetaWebhookSignature } from "@/lib/meta-whatsapp";

describe("Meta webhook signature verification", () => {
  it("accepts the sha256-prefixed signature for the exact raw body", () => {
    const body = '{"entry":[{"id":"test"}]}';
    const signature = createHmac("sha256", "test-app-secret").update(body).digest("hex");

    expect(verifyMetaWebhookSignature(body, `sha256=${signature}`, "test-app-secret")).toBe(true);
  });

  it("rejects malformed or mismatched signatures", () => {
    expect(verifyMetaWebhookSignature("body", "invalid", "test-app-secret")).toBe(false);
    expect(verifyMetaWebhookSignature("body", `sha256=${"a".repeat(64)}`, "test-app-secret")).toBe(false);
  });
});
