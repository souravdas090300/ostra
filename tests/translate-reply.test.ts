import { describe, it, expect } from "vitest";
import { missingTokens } from "@/lib/translate-reply";

describe("missingTokens", () => {
  it("all kept gives []", () => {
    expect(missingTokens("Meet at 15:00, code 1234", "Meet at 15:00, code 1234")).toEqual([]);
  });

  it("a changed price (120 to 130)", () => {
    expect(missingTokens("Price is 120", "Price is 130")).toEqual(["120"]);
  });

  it("a lost time (15:00)", () => {
    expect(missingTokens("Arrive at 15:00", "Arrive at three")).toEqual(["15:00"]);
  });

  it("a lost code (4821#)", () => {
    expect(missingTokens("Use code 4821#", "Use the code")).toEqual(["4821#"]);
  });

  it("a changed link", () => {
    expect(missingTokens("Go to https://example.com", "Go to https://other.com")).toEqual(["https://example.com"]);
  });

  it("a password with punctuation (Seaview!2026)", () => {
    expect(missingTokens("Password: Seaview!2026", "Password: changed")).toEqual(["Seaview!2026"]);
  });

  it("tokens with trailing punctuation are matched correctly", () => {
    expect(missingTokens("Arrive at 15:00.", "Arrive at three.")).toEqual(["15:00"]);
    expect(missingTokens("Code: 1234!", "Code: changed!")).toEqual(["1234"]);
  });

  it("text without digits or links gives []", () => {
    expect(missingTokens("Hello there", "Hola")).toEqual([]);
  });

  it("Arabic-Indic digits in the translation are reported as missing", () => {
    // Arabic-Indic digits: ٠١٢٣٤٥٦٧٨٩
    expect(missingTokens("Code 1234", "Code ١٢٣٤")).toEqual(["1234"]);
  });
});
