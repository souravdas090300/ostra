import { describe, it, expect, vi, beforeEach } from "vitest";

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
      expect(result.sid).toBeNull();
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
      expect(result.sid).toBeNull();
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
      expect(result.sid).toBeNull();
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

      try {
        const sendPromise = sendWhatsApp({
          to: "+35612345678",
          text: "Test message",
        });
        await expect(sendPromise).rejects.toBeInstanceOf(WhatsAppError);
        await expect(sendPromise).rejects.toMatchObject({
          permanent: true,
          kind: "SANDBOX",
        });

        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        if (originalMode === undefined) delete process.env.WHATSAPP_MODE;
        else process.env.WHATSAPP_MODE = originalMode;
        if (originalAllowed === undefined) delete process.env.META_SANDBOX_ALLOWED_NUMBERS;
        else process.env.META_SANDBOX_ALLOWED_NUMBERS = originalAllowed;
        fetchSpy.mockRestore();
      }
    });
  });
});
