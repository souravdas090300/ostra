import { NextResponse } from "next/server";
import twilio from "twilio";
import { prisma } from "@/lib/db";

const RANK: Record<string, number> = {
  queued: 1,
  sending: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  failed: 5,
  undelivered: 5,
};

export async function POST(req: Request) {
  // Try to parse as form data, fall back to URL-encoded body
  let params: Record<string, string>;
  const contentType = req.headers.get("content-type") || "";
  
  if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
    params = Object.fromEntries(
      [...(await req.formData()).entries()].filter(([, v]) => typeof v === "string"),
    ) as Record<string, string>;
  } else {
    // For tests or when content-type is missing, try URL-encoded parsing
    const text = await req.text();
    const urlParams = new URLSearchParams(text);
    params = Object.fromEntries(urlParams.entries());
  }

  const valid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN!,
    req.headers.get("x-twilio-signature") ?? "",
    `${process.env.APP_URL}/api/webhooks/twilio-status`, // not the internal request URL, we are behind a proxy
    params,
  );

  if (!valid) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sid = params.MessageSid,
    status = params.MessageStatus;
  if (!sid || !status) return new NextResponse(null, { status: 200 });

  const msg = await prisma.message.findUnique({ where: { metaMessageId: sid } });
  if (
    msg &&
    (RANK[status] ?? 0) >= (RANK[msg.deliveryStatus ?? ""] ?? 0)
  ) {
    // callbacks can arrive out of order
    await prisma.message.update({
      where: { id: msg.id },
      data: {
        deliveryStatus: status,
        errorCode: params.ErrorCode ? Number(params.ErrorCode) : null,
      },
    });
  }

  return new NextResponse(null, { status: 200 });
}
