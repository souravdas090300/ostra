import { scrub } from "./scrub";

// Only these fields are ever logged. Everything else is dropped, never "redacted": dropping cannot leak.
const ALLOWED = new Set([
  "bookingId",
  "messageId",
  "ownerId",
  "feedId",
  "scheduledId",
  "job",
  "count",
  "created",
  "updated",
  "cancelled",
  "sent",
  "failed",
  "skipped",
  "status",
  "code",
  "durationMs",
  "attempt",
  "mode",
  "reason",
]);

export function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!ALLOWED.has(k)) continue;
    safe[k] = typeof v === "string" ? scrub(v).slice(0, 200) : v;
  }
  console[level](JSON.stringify({ t: new Date().toISOString(), level, event, ...safe }));
}
