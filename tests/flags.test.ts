import { describe, it, expect, beforeEach } from "vitest";
import { assistantEnabled, automaticMessagesEnabled } from "../lib/flags";

describe("flags", () => {
  beforeEach(() => {
    delete process.env.ASSISTANT_ENABLED;
    delete process.env.AUTOMATIC_MESSAGES_ENABLED;
  });

  it("assistant is enabled by default", () => {
    expect(assistantEnabled()).toBe(true);
  });

  it("automatic messages are enabled by default", () => {
    expect(automaticMessagesEnabled()).toBe(true);
  });

  it("assistant is disabled when set to false", () => {
    process.env.ASSISTANT_ENABLED = "false";
    expect(assistantEnabled()).toBe(false);
  });

  it("automatic messages are disabled when set to false", () => {
    process.env.AUTOMATIC_MESSAGES_ENABLED = "false";
    expect(automaticMessagesEnabled()).toBe(false);
  });

  it("other values keep assistant enabled", () => {
    process.env.ASSISTANT_ENABLED = "true";
    expect(assistantEnabled()).toBe(true);

    process.env.ASSISTANT_ENABLED = "0";
    expect(assistantEnabled()).toBe(true);

    process.env.ASSISTANT_ENABLED = "";
    expect(assistantEnabled()).toBe(true);
  });

  it("other values keep automatic messages enabled", () => {
    process.env.AUTOMATIC_MESSAGES_ENABLED = "true";
    expect(automaticMessagesEnabled()).toBe(true);

    process.env.AUTOMATIC_MESSAGES_ENABLED = "0";
    expect(automaticMessagesEnabled()).toBe(true);
  });
});
