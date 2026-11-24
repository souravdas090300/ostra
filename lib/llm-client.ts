import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Central Google Gemini client. The Anthropic SDK remains in the project for
 * reference/fallback but all AI calls currently run through Gemini when
 * GEMINI_API_KEY is configured.
 */
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

let client: GoogleGenerativeAI | null = null;

export function getGoogleGenAI(): GoogleGenerativeAI {
  if (!client) {
    client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");
  }
  return client;
}
