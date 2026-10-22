import { createHmac } from "node:crypto";

const hmac = (v: string) => createHmac("sha256", process.env.DATA_PEPPER || "default-pepper").update(v.trim().toLowerCase()).digest("hex");

export function hashPhone(e164: string): string {
  return hmac(e164);
}
