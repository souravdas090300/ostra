import { prisma } from "./db";

// WebCrypto (not node:crypto) so this module stays Edge-safe: auth.config is
// bundled into middleware.ts, which runs on the Edge runtime.
const encoder = new TextEncoder();

async function hmac(v: string): Promise<string> {
  const pepper = process.env.DATA_PEPPER || "default-pepper";
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(v.trim().toLowerCase()),
  );
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function clientIp(headers: Headers): string {
  if (process.env.TRUST_PROXY === "1") {
    const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}

export async function isLockedOut(email: string, ip: string, now = new Date()): Promise<boolean> {
  const [emailHash, ipHash] = await Promise.all([hmac(email), hmac(ip)]);
  const [byEmail, byIp] = await Promise.all([
    prisma.loginAttempt.count({
      where: {
        emailHash,
        success: false,
        createdAt: { gte: new Date(now.getTime() - 15 * 60_000) },
      },
    }),
    prisma.loginAttempt.count({
      where: {
        ipHash,
        success: false,
        createdAt: { gte: new Date(now.getTime() - 60 * 60_000) },
      },
    }),
  ]);
  return byEmail >= 5 || byIp >= 20;
}

export async function recordAttempt(email: string, ip: string, success: boolean) {
  await prisma.loginAttempt.create({
    data: {
      emailHash: await hmac(email),
      ipHash: await hmac(ip),
      success,
    },
  });
}
