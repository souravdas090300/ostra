import { after, NextResponse } from "next/server";
import { handleMetaPayload } from "@/lib/meta-webhook";
import { verifyMetaWebhookSignature } from "@/lib/meta-whatsapp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Meta's subscription handshake.
export function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  if (q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return new Response(q.get("hub.challenge") ?? "", { status: 200 });   // the raw value, never JSON
  }
  return new Response("Forbidden", { status: 403 });
}

export function validSignature(raw: string, header: string | null): boolean {
  return verifyMetaWebhookSignature(header, raw);
}

export async function POST(req: Request) {
  const raw = await req.text();                       // the raw body, read BEFORE any JSON parsing
  if (!validSignature(raw, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return new NextResponse(null, { status: 200 }); }
  after(async () => {
    try { await handleMetaPayload(payload); }
    catch { /* reportError(e, { tags: { job: "meta-webhook" } }): never include the payload */ }
  });
  return new NextResponse(null, { status: 200 });     // acknowledge fast, Meta retries on failures
}
