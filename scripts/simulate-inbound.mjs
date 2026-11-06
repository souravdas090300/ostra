// node scripts/simulate-inbound.mjs +4915112345678 "Hello" <META_PHONE_NUMBER_ID>
// Needs APP_URL, META_PHONE_NUMBER_ID and META_APP_SECRET. Works in WHATSAPP_MODE=dry-run.
import { createHmac, randomUUID } from "node:crypto";

const [, , from, body, phoneNumberId = process.env.META_PHONE_NUMBER_ID] = process.argv;
const appSecret = process.env.META_APP_SECRET;
if (!from || !body || !phoneNumberId || !appSecret) {
  console.error("Usage: simulate-inbound.mjs <guestE164> <text> [phoneNumberId]");
  console.error("Set APP_URL, META_PHONE_NUMBER_ID and META_APP_SECRET.");
  process.exit(1);
}

const url = `${process.env.APP_URL}/api/webhooks/meta`;
const payload = {
  object: "whatsapp_business_account",
  entry: [{
    changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: phoneNumberId },
        messages: [{
          from: from.replace(/^\+/, ""),
          id: `wamid.${randomUUID()}`,
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: "text",
          text: { body },
        }],
      },
    }],
  }],
};
const raw = JSON.stringify(payload);
const signature = createHmac("sha256", appSecret).update(raw, "utf8").digest("hex");
const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${signature}` },
  body: raw,
});
console.log("status", res.status);
