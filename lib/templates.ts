import { createHash } from "crypto";

type MessageType = "PRE_ARRIVAL" | "CHECK_IN" | "CHECK_OUT" | "REVIEW_REQUEST";

export const TEMPLATE_VARS: Record<MessageType, readonly string[]> = {
  PRE_ARRIVAL: ["guestName", "apartmentName", "checkInDate", "checkInTime"],
  CHECK_IN: ["guestName", "apartmentName", "checkInTime"],
  CHECK_OUT: ["guestName", "apartmentName", "checkOutTime"],
  REVIEW_REQUEST: ["guestName", "apartmentName", "reviewUrl"],
};

export const TEMPLATE_CATEGORY: Record<MessageType, "UTILITY" | "MARKETING"> = {
  PRE_ARRIVAL: "UTILITY",
  CHECK_IN: "UTILITY",
  CHECK_OUT: "UTILITY",
  REVIEW_REQUEST: "MARKETING",
};

// English defaults. No variable at the very start or end (WhatsApp rejects that), no secrets.
export const DEFAULT_TEMPLATES: Record<MessageType, string> = {
  PRE_ARRIVAL:
    "Hello {{guestName}}, we are looking forward to welcoming you to {{apartmentName}} on {{checkInDate}}. Check-in is from {{checkInTime}}. Reply to this message if you would like your arrival instructions or have any questions. Reply STOP to stop receiving messages.",
  CHECK_IN:
    "Welcome, {{guestName}}! {{apartmentName}} is ready for you from {{checkInTime}}. Reply here and we will send your check-in details right away. Reply STOP to stop receiving messages.",
  CHECK_OUT:
    "Hello {{guestName}}, a reminder that check-out from {{apartmentName}} is tomorrow by {{checkOutTime}}. Reply here if you have any questions. Reply STOP to stop receiving messages.",
  REVIEW_REQUEST:
    "Thank you for staying at {{apartmentName}}, {{guestName}}! If you enjoyed your stay, we would really appreciate a short review: {{reviewUrl}} Reply STOP to stop receiving messages.",
};

export const MAX_BODY = 1024;
const VAR_RE = /\{\{\s*([A-Za-z]+)\s*\}\}/g;

/** Variable names in order of first appearance. */
export function extractVars(body: string): string[] {
  const seen: string[] = [];
  for (const m of body.matchAll(VAR_RE)) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
}

/** Returns a list of human-readable problems; empty means valid. */
export function validateTemplate(type: MessageType, body: string): string[] {
  const errors: string[] = [];
  const text = body.trim();
  if (!text) return ["The message is empty."];
  if (text.length > MAX_BODY) errors.push(`The message is longer than ${MAX_BODY} characters.`);
  const allowed = TEMPLATE_VARS[type];
  for (const v of extractVars(text)) if (!allowed.includes(v)) errors.push(`Unknown variable {{${v}}}.`);
  if (/^\{\{[^}]*\}\}/.test(text)) errors.push("The message cannot start with a variable.");
  if (/\{\{[^}]*\}\}$/.test(text)) errors.push("The message cannot end with a variable.");
  if (/\{\{[^}]*\}\}\s*\{\{[^}]*\}\}/.test(text)) errors.push("Two variables cannot be next to each other.");
  return errors;
}

/** {{guestName}} -> {{1}} by order of first appearance. `order` maps numbers back to names. */
export function toMetaBody(body: string): { body: string; order: string[] } {
  const order = extractVars(body);
  return {
    body: body.replace(VAR_RE, (_m, name: string) => `{{${order.indexOf(name) + 1}}}`),
    order,
  };
}

// Legacy alias for backward compatibility
export const toTwilioBody = toMetaBody;

export const fillTemplate = (body: string, values: Record<string, string>): string =>
  body.replace(VAR_RE, (_m, name: string) => values[name] ?? "");

export const hashSource = (body: string): string =>
  createHash("sha1").update(body.trim()).digest("hex").slice(0, 12);
