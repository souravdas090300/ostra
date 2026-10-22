import { createHmac } from "node:crypto";
import { prisma } from "./db";

const hmac = (v: string) => createHmac("sha256", process.env.DATA_PEPPER || "default-pepper").update(v.trim().toLowerCase()).digest("hex");

export function clientIp(headers: Headers): string {
  if (process.env.TRUST_PROXY === "1") {
    const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}

export async function isLockedOut(email: string, ip: string, now = new Date()): Promise<boolean> {
  const [byEmail, byIp] = await Promise.all([
    prisma.loginAttempt.count({
      where: {
        emailHash: hmac(email),
        success: false,
        createdAt: { gte: new Date(now.getTime() - 15 * 60_000) },
      },
    }),
    prisma.loginAttempt.count({
      where: {
        ipHash: hmac(ip),
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
      emailHash: hmac(email),
      ipHash: hmac(ip),
      success,
    },
  });
}
