import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { buildSystemPrompt, type PromptInput } from "./assistant-prompt";
import { normaliseLanguage } from "./languages";
import { unsupportedContacts } from "./guards";

const client = new Anthropic({ timeout: 25_000, maxRetries: 1 });
export class AssistantError extends Error {}

export type ChatTurn = { role: "user" | "assistant"; text: string };
export type AssistantOutput = {
  language: string | null;
  reply: string;
  escalate: boolean;
  urgent: boolean;
  reason: string;
  hostSummary: string;
  optOut: boolean;
};

const RESPOND_TOOL = {
  name: "respond",
  description: "Send the reply to the guest and report what happened.",
  input_schema: {
    type: "object" as const,
    properties: {
      language: { type: "string", description: "ISO 639-1 code of the language of the guest's latest message (nb for Norwegian)." },
      reply: { type: "string", description: "The WhatsApp message to send to the guest, in the guest's language." },
      escalate: { type: "boolean", description: "True if the host must handle this." },
      urgent: { type: "boolean", description: "True only for emergencies." },
      reason: { type: "string", description: "Short English reason when escalate is true, otherwise empty." },
      host_summary: { type: "string", description: "One or two sentences for the host, in the host's language." },
      opt_out: { type: "boolean", description: "True if the guest asked to stop receiving messages." },
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

// Safe replies when the model cannot be used. Languages with no entry get English.
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
  };
}

const TURN_MAX = 1000;
type Stored = { direction: "INBOUND" | "OUTBOUND"; body: string };

/** Alternating user/assistant turns that start with a user turn. Guest text is wrapped as untrusted data. */
export function buildHistory(previous: Stored[], current: string): ChatTurn[] {
  const turns: ChatTurn[] = [];
  const push = (role: ChatTurn["role"], text: string) => {
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.text += `\n${text}`;
    else turns.push({ role, text });
  };
  for (const m of previous) {
    const body = m.body.slice(0, TURN_MAX);
    if (m.direction === "INBOUND") push("user", `<guest_message>${body}</guest_message>`);
    else push("assistant", body);
  }
  push("user", `<guest_message>${current.slice(0, TURN_MAX)}</guest_message>`);
  if (turns[0].role === "assistant")
    turns.unshift({ role: "user", text: "(The conversation started with the host's automatic message.)" });
  return turns;
}

export type AnswerInput = PromptInput & { history: ChatTurn[]; allowedText: string };

export async function answerGuest(input: AnswerInput): Promise<AssistantOutput> {
  let res;
  try {
    res = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
      max_tokens: 800,
      system: buildSystemPrompt(input),
      tools: [RESPOND_TOOL],
      tool_choice: { type: "tool", name: "respond" },
      messages: input.history.map((t) => ({ role: t.role, content: t.text })),
    });
  } catch {
    throw new AssistantError("The AI service is unavailable.");
  }
  const block = res.content.find((c) => c.type === "tool_use");
  const parsed = block && block.type === "tool_use" ? outputSchema.safeParse(block.input) : null;
  if (!parsed || !parsed.success) throw new AssistantError("The AI returned an unusable answer.");
  const o = parsed.data;

  const out: AssistantOutput = {
    language: normaliseLanguage(o.language),
    reply: o.reply.trim(),
    escalate: o.escalate,
    urgent: o.urgent,
    reason: o.reason.trim(),
    hostSummary: o.host_summary.trim(),
    optOut: o.opt_out,
  };

  // Code-level checks on what the model wrote.
  if (!out.reply || out.reply.length > 1200) {
    return {
      ...fallbackOutput(
        out.language,
        "The assistant produced an unusable reply.",
        out.hostSummary || "A guest message needs your attention."
      ),
      optOut: out.optOut,
    };
  }
  const bad = unsupportedContacts(out.reply, input.allowedText);
  if (bad) {
    return {
      ...fallbackOutput(
        out.language,
        "Assistant reply blocked: it contained a link or number that is not in your information.",
        out.hostSummary || "A guest message needs your attention."
      ),
      optOut: out.optOut,
    };
  }
  if (out.urgent) out.escalate = true;
  return out;
}
