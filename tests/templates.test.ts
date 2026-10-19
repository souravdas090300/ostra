import { describe, it, expect } from "vitest";
import {
  extractVars,
  validateTemplate,
  toTwilioBody,
  fillTemplate,
  hashSource,
  DEFAULT_TEMPLATES,
  TEMPLATE_VARS,
} from "@/lib/templates";

describe("extractVars", () => {
  it("extracts variables in order of first appearance", () => {
    expect(extractVars("Hello {{guestName}}, welcome to {{apartmentName}}")).toEqual([
      "guestName",
      "apartmentName",
    ]);
  });

  it("handles repeated variables", () => {
    expect(extractVars("{{guestName}} {{guestName}}")).toEqual(["guestName"]);
  });

  it("returns empty array when no variables", () => {
    expect(extractVars("Hello world")).toEqual([]);
  });
});

describe("validateTemplate", () => {
  it("accepts valid default templates", () => {
    for (const [type, body] of Object.entries(DEFAULT_TEMPLATES)) {
      expect(validateTemplate(type as any, body)).toEqual([]);
    }
  });

  it("rejects empty message", () => {
    expect(validateTemplate("PRE_ARRIVAL", "")).toEqual(["The message is empty."]);
  });

  it("rejects message over 1024 characters", () => {
    const long = "x".repeat(1025);
    expect(validateTemplate("PRE_ARRIVAL", long)).toEqual([
      "The message is longer than 1024 characters.",
    ]);
  });

  it("rejects unknown variable", () => {
    const errors = validateTemplate("PRE_ARRIVAL", "Hello {{unknownVar}}");
    expect(errors).toContain("Unknown variable {{unknownVar}}.");
  });

  it("rejects message starting with variable", () => {
    expect(validateTemplate("PRE_ARRIVAL", "{{guestName}} hello")).toEqual([
      "The message cannot start with a variable.",
    ]);
  });

  it("rejects message ending with variable", () => {
    expect(validateTemplate("PRE_ARRIVAL", "hello {{guestName}}")).toEqual([
      "The message cannot end with a variable.",
    ]);
  });

  it("rejects adjacent variables", () => {
    const errors = validateTemplate("PRE_ARRIVAL", "{{guestName}}{{apartmentName}}");
    expect(errors).toContain("Two variables cannot be next to each other.");
  });
});

describe("toTwilioBody", () => {
  it("numbers variables by first appearance", () => {
    const result = toTwilioBody("Hello {{guestName}}, welcome to {{apartmentName}}");
    expect(result.body).toBe("Hello {{1}}, welcome to {{2}}");
    expect(result.order).toEqual(["guestName", "apartmentName"]);
  });

  it("handles repeated variables", () => {
    const result = toTwilioBody("{{guestName}} {{guestName}}");
    expect(result.body).toBe("{{1}} {{1}}");
    expect(result.order).toEqual(["guestName"]);
  });
});

describe("fillTemplate", () => {
  it("replaces variables with values", () => {
    const result = fillTemplate("Hello {{guestName}}, welcome to {{apartmentName}}", {
      guestName: "Anna",
      apartmentName: "Seaview",
    });
    expect(result).toBe("Hello Anna, welcome to Seaview");
  });

  it("handles missing values gracefully", () => {
    const result = fillTemplate("Hello {{guestName}}", {});
    expect(result).toBe("Hello ");
  });
});

describe("hashSource", () => {
  it("produces consistent hash for same text", () => {
    const text = "Hello {{guestName}}";
    const h1 = hashSource(text);
    const h2 = hashSource(text);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(12);
  });

  it("produces different hash for different text", () => {
    expect(hashSource("Hello {{guestName}}")).not.toBe(hashSource("Hello {{name}}"));
  });

  it("ignores whitespace", () => {
    expect(hashSource("Hello {{guestName}}")).toBe(hashSource("  Hello {{guestName}}  "));
  });
});
