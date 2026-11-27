import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Central Google Gemini client. The Anthropic SDK remains in the project for
 * reference/fallback but all AI calls currently run through Gemini when
 * GEMINI_API_KEY is configured.
 *
 * Test seam: when LLM_FAKE=1 (or "true") a deterministic fake client is
 * returned instead of calling the API. The fake answers the `respond` tool
 * with "FAKE REPLY" (escalating when the guest text contains "refund"), the
 * `draft` tool with a fixed review reply, and echoes <message>…</message>
 * content for plain generateContent calls (translations stay valid).
 * LLM_FAKE throws when NODE_ENV=production unless E2E=1, which only the
 * Playwright webServer sets — a real production deploy must never fake the AI.
 */
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

let client: GoogleGenerativeAI | null = null;

const FAKE_USAGE = { promptTokenCount: 10, candidatesTokenCount: 10 };

function fakeResult(toolName: string | undefined, promptText: string) {
  const escalate = /refund/i.test(promptText);
  const calls =
    toolName === "respond"
      ? [
          {
            name: "respond",
            args: {
              language: "en",
              reply: "FAKE REPLY",
              escalate,
              urgent: false,
              reason: escalate ? "Fake escalation: refund mentioned" : "",
              host_summary: "Fake host summary.",
              opt_out: false,
            },
          },
        ]
      : toolName === "draft"
        ? [
            {
              name: "draft",
              args: {
                language: "en",
                reply: "FAKE REVIEW REPLY",
                host_translation: "FAKE REVIEW REPLY",
                risk: "none",
                risk_note: "",
              },
            },
          ]
        : undefined;
  const text =
    toolName === undefined
      ? (/<message>([\s\S]*?)<\/message>/.exec(promptText)?.[1] ?? "FAKE TRANSLATION")
      : "";
  return {
    response: {
      functionCalls: () => calls,
      text: () => text,
      usageMetadata: FAKE_USAGE,
    },
  };
}

function promptToText(content: unknown): string {
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content);
  } catch {
    return "";
  }
}

function fakeToolName(config: unknown): string | undefined {
  const decls = (config as { tools?: { functionDeclarations?: { name?: string }[] }[] })
    ?.tools?.[0]?.functionDeclarations;
  return decls?.[0]?.name;
}

const fakeClient = {
  getGenerativeModel: (config?: unknown) => {
    const toolName = fakeToolName(config);
    return {
      startChat: () => ({
        sendMessage: async (content: unknown) =>
          fakeResult(toolName, promptToText(content)),
      }),
      generateContent: async (prompt: unknown) =>
        fakeResult(toolName, promptToText(prompt)),
    };
  },
} as unknown as GoogleGenerativeAI;

export function getGoogleGenAI(): GoogleGenerativeAI {
  if (process.env.LLM_FAKE === "1" || process.env.LLM_FAKE === "true") {
    if (process.env.NODE_ENV === "production" && process.env.E2E !== "1") {
      throw new Error("LLM_FAKE must not be set when NODE_ENV=production.");
    }
    return fakeClient;
  }
  if (!client) {
    client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");
  }
  return client;
}
