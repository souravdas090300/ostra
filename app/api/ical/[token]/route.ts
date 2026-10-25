import { prisma } from "@/lib/db";
import { addDays, todayMalta } from "@/lib/dates";
import { buildIcs, etagOf, selectStays } from "@/lib/ical-export";
import { loadApartmentStays } from "@/lib/export-data";
import { clientIp } from "@/lib/login-guard";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });

async function handle(req: Request, params: Promise<{ token: string }>, head: boolean) {
  const raw = (await params).token;
  const token = raw.endsWith(".ics") ? raw.slice(0, -4) : raw;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return NOT_FOUND();
  if (!rateLimit(`ical:${clientIp(req.headers)}`, 60, 60_000)) return new Response("Too many requests", { status: 429 });

  const feed = await prisma.exportFeed.findUnique({ where: { token } });
  if (!feed || !feed.enabled) return NOT_FOUND(); // unknown, disabled and revoked links look the same

  // Record that a platform read the link, at most once a minute.
  const now = new Date();
  if (!feed.lastFetchedAt || now.getTime() - feed.lastFetchedAt.getTime() > 60_000) {
    await prisma.exportFeed.update({ where: { id: feed.id }, data: { lastFetchedAt: now, fetchCount: { increment: 1 } } });
  }

  const today = todayMalta(now);
  const stays = await loadApartmentStays(feed.apartmentId, addDays(today, -1), addDays(today, 730));
  const body = buildIcs(selectStays(feed.target, stays, today));
  const etag = etagOf(body);
  const headers = {
    etag,
    "cache-control": "private, max-age=300",
    "x-robots-tag": "noindex",
    "content-type": "text/calendar; charset=utf-8",
    "content-disposition": 'inline; filename="ostra.ics"',
  };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag } });
  return new Response(head ? null : body, { status: 200, headers });
}

export const GET = (req: Request, ctx: { params: Promise<{ token: string }> }) => handle(req, ctx.params, false);
export const HEAD = (req: Request, ctx: { params: Promise<{ token: string }> }) => handle(req, ctx.params, true);
