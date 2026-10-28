import dotenv from "dotenv";
import { vi } from "vitest";

// Load .env.test environment variables before any imports
dotenv.config({ path: ".env.test" });

// Hoist Anthropic mock before any imports
const MockAnthropic = vi.hoisted(() => {
  class MockAnthropic {
    messages = {
      create: vi.fn(),
    };
  }
  return MockAnthropic;
});

vi.mock("@anthropic-ai/sdk", () => ({
  default: MockAnthropic,
}));

// Mock Next.js dependencies
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url) => {
    const error = new Error(`NEXT_REDIRECT: ${url}`);
    (error as Error & { digest: string }).digest = "NEXT_REDIRECT";
    throw error;
  }),
  notFound: vi.fn(() => {
    const error = new Error("NEXT_NOT_FOUND");
    (error as Error & { digest: string }).digest = "NEXT_NOT_FOUND";
    throw error;
  }),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  usePathname: vi.fn(() => "/"),
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (fn: () => unknown) => {
      // Run immediately in tests to avoid "outside request scope" error
      void fn();
    },
  };
});

vi.mock("@/lib/notify", () => ({
  notifyHost: vi.fn(),
}));

// Do NOT mock flags - they must read environment at call time

// Mock WhatsApp send function (returns dry-run ID by default, overridable in tests)
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsApp: vi.fn(() => Promise.resolve({ id: null })),
  whatsappMode: vi.fn(() => "dry-run"),
  WhatsAppError: class extends Error {
    constructor(message: string, public permanent: boolean, public code?: number) {
      super(message);
    }
  },
}));

// Mock Meta WhatsApp Cloud API
vi.mock("@/lib/meta-api", () => ({
  sendMetaMessage: vi.fn(() => Promise.resolve({ id: "msg_test" })),
  verifyMetaWebhookSignature: vi.fn(() => true),
}));
