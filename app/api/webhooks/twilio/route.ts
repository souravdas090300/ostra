import { after, NextResponse } from "next/server";
import twilio from "twilio";
import { processInbound } from "@/lib/inbound";

export const dynamic = "force-dynamic";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

export async function POST(req: Request) {
  const params = Object.fromEntries(
    [...(await req.formData()).entries()].filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;

  const valid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN!,
    req.headers.get("x-twilio-signature") ?? "",
    `${process.env.APP_URL}/api/webhooks/twilio`, // the public URL, not the internal one behind a proxy
    params
  );
  if (!valid) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { MessageSid, From, To } = params;
  if (!MessageSid || !From || !To) return new NextResponse(EMPTY_TWIML, { headers: { "content-type": "text/xml" } });

  after(async () => {
    try {
      await processInbound({
        sid: MessageSid,
        from: From,
        to: To,
        body: params.Body || params.ButtonText || "",
        numMedia: Number(params.NumMedia ?? 0),
      });
    } catch {
      console.error("inbound failed", { sid: MessageSid }); // never log the payload
    }
  });
  return new NextResponse(EMPTY_TWIML, { headers: { "content-type": "text/xml" } });
}
