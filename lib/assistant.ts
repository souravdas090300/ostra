import { SchemaType, FunctionCallingMode, type FunctionDeclaration } from "@google/generative-ai";
import { z } from "zod";
import { buildSystemPrompt, type PromptInput } from "./assistant-prompt";
import { normaliseLanguage } from "./languages";
import { unsupportedContacts } from "./guards";
import { getGoogleGenAI, GEMINI_MODEL } from "./llm-client";
import { reportError } from "./report-error";

export class AssistantError extends Error {}

export type ChatTurn = { role: "user" | "assistant"; content: string };
export type AssistantOutput = {
  language: string | null;
  reply: string;
  escalate: boolean;
  urgent: boolean;
  reason: string;
  hostSummary: string;
  optOut: boolean;
  usage: { input: number; output: number };
};

const RESPOND_TOOL: FunctionDeclaration = {
  name: "respond",
  description: "Send the reply to the guest and report what happened.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      language: { type: SchemaType.STRING, description: "ISO 639-1 code of the language of the guest's latest message (nb for Norwegian)." },
      reply: { type: SchemaType.STRING, description: "The WhatsApp message to send to the guest, in the guest's language." },
      escalate: { type: SchemaType.BOOLEAN, description: "True if the host must handle this." },
      urgent: { type: SchemaType.BOOLEAN, description: "True only for emergencies." },
      reason: { type: SchemaType.STRING, description: "Short English reason when escalate is true, otherwise empty." },
      host_summary: { type: SchemaType.STRING, description: "One or two sentences for the host, in the host's language." },
      opt_out: { type: SchemaType.BOOLEAN, description: "True if the guest asked to stop receiving messages." },
    },
    required: ["language", "reply", "escalate", "urgent", "reason", "host_summary", "opt_out"],
  },
};

const outputSchema = z.object({
  language: z.string().max(10),
  reply: z.string().max(4000),
  escalate: z.boolean(),
  urgent: z.boolean(),
  reason: z.string().max(300),
  host_summary: z.string().max(600),
  opt_out: z.boolean(),
});

export const HOLDING: Record<string, string> = {
  en: "Thanks for your message. I have passed it to your host, who will get back to you shortly.",
  it: "Grazie per il messaggio. L'ho inoltrato al tuo host, che ti risponderà al più presto.",
  de: "Danke für Ihre Nachricht. Ich habe sie an Ihren Gastgeber weitergeleitet, der sich in Kürze bei Ihnen melden wird.",
  fr: "Merci pour votre message. Je l'ai transmis à votre hôte, qui vous répondra rapidement.",
  es: "Gracias por su mensaje. Se lo he pasado a su anfitrión, que le responderá en breve.",
  ar: "شكرًا على رسالتك. لقد أرسلتها إلى المضيف وسيرد عليك قريبًا.",
};
export const holdingText = (lang: string | null) => HOLDING[lang ?? "en"] ?? HOLDING.en;

export function fallbackOutput(lang: string | null, reason: string, hostLanguageSummary: string): AssistantOutput {
  return {
    language: lang,
    reply: holdingText(lang),
    escalate: true,
    urgent: false,
    reason,
    hostSummary: hostLanguageSummary,
    optOut: false,
    usage: { input: 0, output: 0 },
  };
}

const TURN_MAX = 1000;
type Stored = { direction: "INBOUND" | "OUTBOUND"; body: string };

export function buildHistory(previous: Stored[], current: string): ChatTurn[] {
  const turns: ChatTurn[] = [];
  const push = (role: ChatTurn["role"], text: string) => {
    const last = turns.at(-1);
    if (last?.role === role) last.content += `\n${text}`;
    else turns.push({ role, content: text });
  };
  for (const m of previous) {
    const body = m.body.slice(0, TURN_MAX);
    if (m.direction === "INBOUND") push("user", `<guest_message>${body}</guest_message>`);
    else push("assistant", body);
  }
  push("user", `<guest_message>${current.slice(0, TURN_MAX)}</guest_message>`);
  if (turns[0]?.role === "assistant")
    turns.unshift({ role: "user", content: "(The conversation started with the host's automatic message.)" });
  return turns;
}

export type AnswerInput = PromptInput & { history: ChatTurn[]; allowedText: string };

export async function answerGuest(input: AnswerInput): Promise<AssistantOutput> {
  const model = getGoogleGenAI().getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: buildSystemPrompt(input),
    tools: [{ functionDeclarations: [RESPOND_TOOL] }],
    toolConfig: {
      functionCallingConfig: {
        mode: FunctionCallingMode.ANY,
        allowedFunctionNames: ["respond"],
      },
    },
  });

  let res;
  try {
    // Gemini requires "model" instead of "assistant" for roles
    const geminiHistory = input.history.slice(0, -1).map((t) => ({
      role: t.role === "assistant" ? "model" : "user",
      parts: [{ text: t.content }],
    }));

    // The last turn is always the current user message
    const lastMessage = input.history[input.history.length - 1]?.content ?? "";

    const chat = model.startChat({
      history: geminiHistory.length > 0 ? geminiHistory : undefined,
    });

    res = await chat.sendMessage(lastMessage);
  } catch (error) {
    reportError(error, { job: "assistant" });
    throw new AssistantError("The AI service is unavailable.");
  }

  const functionCalls = res.response.functionCalls();
  const block = functionCalls?.find((c) => c.name === "respond");
  const parsed = block ? outputSchema.safeParse(block.args) : null;

  if (!parsed?.success) throw new AssistantError("The AI returned an unusable answer.");
  const o = parsed.data;

  const usage = {
    input: res.response.usageMetadata?.promptTokenCount || 0,
    output: res.response.usageMetadata?.candidatesTokenCount || 0,
  };

  const out: AssistantOutput = {
    language: normaliseLanguage(o.language),
    reply: o.reply.trim(),
    escalate: o.escalate,
    urgent: o.urgent,
    reason: o.reason.trim(),
    hostSummary: o.host_summary.trim(),
    optOut: o.opt_out,
    usage,
  };

  if (!out.reply || out.reply.length > 1200) {
    return { ...fallbackOutput(out.language, "The assistant produced an unusable reply.", out.hostSummary || "A guest message needs your attention."), optOut: out.optOut };
  }
  const bad = unsupportedContacts(out.reply, input.allowedText);
  if (bad) {
    return { ...fallbackOutput(out.language, "Assistant reply blocked: it contained a link or number that is not in your information.", out.hostSummary || "A guest message needs your attention."), optOut: out.optOut };
  }
  if (out.urgent) out.escalate = true;
  return out;
}
