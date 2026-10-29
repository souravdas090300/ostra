import { describe, it, expect, vi } from "vitest";
import { buildHistory, holdingText, fallbackOutput, type AssistantOutput } from "../lib/assistant";

// Mock Anthropic
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: vi.fn() };
  },
}));

describe("buildHistory", () => {
  it("alternates roles correctly", () => {
    const previous = [
      { direction: "INBOUND" as const, body: "Hello" },
      { direction: "OUTBOUND" as const, body: "Hi there" },
    ];
    const history = buildHistory(previous, "Goodbye");
    expect(history[0].role).toBe("user");
    expect(history[1].role).toBe("assistant");
    expect(history[2].role).toBe("user");
  });

  it("uses content field (not text) for Anthropic SDK compatibility", () => {
    const previous = [
      { direction: "INBOUND" as const, body: "Hello" },
      { direction: "OUTBOUND" as const, body: "Hi there" },
    ];
    const history = buildHistory(previous, "Goodbye");
    expect(history.every(m => 'content' in m && !('text' in m))).toBe(true);
  });

  it("merges consecutive guest messages", () => {
    const previous = [
      { direction: "INBOUND" as const, body: "Hello" },
      { direction: "INBOUND" as const, body: "World" },
    ];
    const history = buildHistory(previous, "!");
    expect(history[0].content).toContain("Hello");
    expect(history[0].content).toContain("World");
    expect(history).toHaveLength(1);
  });

  it("starts with a user turn when first message is outbound", () => {
    const previous = [{ direction: "OUTBOUND" as const, body: "Welcome" }];
    const history = buildHistory(previous, "Hi");
    expect(history[0].role).toBe("user");
    expect(history[0].content).toContain("started with the host's automatic message");
  });

  it("wraps guest messages in tags", () => {
    const previous = [{ direction: "INBOUND" as const, body: "Hello" }];
    const history = buildHistory(previous, "World");
    expect(history[0].content).toContain("<guest_message>Hello</guest_message>");
    expect(history[0].content).toContain("<guest_message>World</guest_message>");
  });

  it("truncates long messages", () => {
    const longText = "a".repeat(1500);
    const previous = [{ direction: "INBOUND" as const, body: longText }];
    const history = buildHistory(previous, "!");
    expect(history[0].content.length).toBeLessThan(1100); // 1000 + tags
  });

  it("puts current message last", () => {
    const previous = [{ direction: "INBOUND" as const, body: "Hello" }];
    const history = buildHistory(previous, "World");
    expect(history.at(-1)?.content).toContain("World");
  });
});

describe("holdingText", () => {
  it("returns English for known language", () => {
    expect(holdingText("en")).toContain("Thanks for your message");
  });

  it("returns Italian for known language", () => {
    expect(holdingText("it")).toContain("Grazie per il messaggio");
  });

  it("falls back to English for unknown language", () => {
    expect(holdingText("xx")).toContain("Thanks for your message");
  });

  it("falls back to English for null", () => {
    expect(holdingText(null)).toContain("Thanks for your message");
  });
});

describe("fallbackOutput", () => {
  it("returns holding reply with escalate true", () => {
    const result = fallbackOutput("en", "Test reason", "Test summary");
    expect(result.escalate).toBe(true);
    expect(result.reply).toContain("Thanks for your message");
    expect(result.reason).toBe("Test reason");
    expect(result.hostSummary).toBe("Test summary");
    expect(result.usage).toEqual({ input: 0, output: 0 });
  });

  it("sets optOut to false by default", () => {
    const result = fallbackOutput("en", "Test", "Test");
    expect(result.optOut).toBe(false);
    expect(result.usage).toEqual({ input: 0, output: 0 });
  });
});
