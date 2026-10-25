import { timingSafeEqual } from "crypto";

export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const a = Buffer.from(req.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireCronAuth(req: Request): Response | null {
  if (!cronAuthorized(req)) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}
