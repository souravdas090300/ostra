import { describe, it, expect, vi, beforeEach } from "vitest";
import { recordUsage } from "@/lib/usage";

// Import the real implementation (not mocked in setup.ts)
vi.unmock("@/lib/whatsapp");
vi.unmock("@/lib/usage");
import { sendWhatsApp, WhatsAppError } from "@/lib/whatsapp";

vi.mock("@/lib/usage", () => ({
  recordUsage: vi.fn(),
}));

describe("whatsapp-sandbox (real implementation)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("sendWhatsApp dry-run fallback (kill-switch)", () => {
    it("returns null without fetch when WHATSAPP_MODE is missing", async () => {
      const fetchSpy = vi.spyOn(global, "fetch");
      const originalMode = process.env.WHATSAPP_MODE;
      delete process.env.WHATSAPP_MODE;

      const result = await sendWhatsApp({
        to: "+35612345678",
        text: "Test message",
      });

      process.env.WHATSAPP_MODE = originalMode;
      expect(result.id).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns null without fetch for invalid WHATSAPP_MODE", async () => {
      const fetchSpy = vi.spyOn(global, "fetch");
      const originalMode = process.env.WHATSAPP_MODE;
      process.env.WHATSAPP_MODE = "banana";

      const result = await sendWhatsApp({
        to: "+35612345678",
        text: "Test message",
      });

      process.env.WHATSAPP_MODE = originalMode;
      expect(result.id).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns null without fetch in dry-run mode", async () => {
      const fetchSpy = vi.spyOn(global, "fetch");
      const originalMode = process.env.WHATSAPP_MODE;
      process.env.WHATSAPP_MODE = "dry-run";

      const result = await sendWhatsApp({
        to: "+35612345678",
        text: "Test message",
      });

      process.env.WHATSAPP_MODE = originalMode;
      expect(result.id).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("sendWhatsApp sandbox allow-list (safety control)", () => {
    it("rejects recipient not on META_SANDBOX_ALLOWED_NUMBERS with permanent error, no fetch", async () => {
      const fetchSpy = vi.spyOn(global, "fetch");
      const originalMode = process.env.WHATSAPP_MODE;
      const originalAllowed = process.env.META_SANDBOX_ALLOWED_NUMBERS;

      process.env.WHATSAPP_MODE = "sandbox";
      process.env.META_SANDBOX_ALLOWED_NUMBERS = "+35699999999,+35688888888";

      await expect(
        sendWhatsApp({
          to: "+35612345678", // Not in allowed list
          text: "Test message",
        })
      ).rejects.toThrowError(WhatsAppError);

      process.env.WHATSAPP_MODE = originalMode;
      process.env.META_SANDBOX_ALLOWED_NUMBERS = originalAllowed;

      // Verify it's a permanent SANDBOX error
      try {
        await sendWhatsApp({
          to: "+35612345678",
          text: "Test message",
        });
      } catch (e) {
        expect(e).toBeInstanceOf(WhatsAppError);
        const err = e as WhatsAppError;
        expect(err.permanent).toBe(true);
        expect(err.kind).toBe("SANDBOX");
      }

      // Critical: fetch was never called (before any network call)
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
