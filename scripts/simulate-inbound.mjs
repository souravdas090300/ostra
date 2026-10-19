// node scripts/simulate-inbound.mjs +4915112345678 "What is the wifi password?" +35679123456
// Needs APP_URL and TWILIO_AUTH_TOKEN (the same values the app uses). Works in WHATSAPP_MODE=dry-run.
import twilio from "twilio";

const [, , from, body, to] = process.argv;
if (!from || !body || !to) {
  console.error("Usage: simulate-inbound.mjs <guestE164> <text> <hostWhatsAppE164>");
  process.exit(1);
}

const url = `${process.env.APP_URL}/api/webhooks/twilio`;
const params = {
  MessageSid: "SM" + [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16)).join(""),
  From: `whatsapp:${from}`,
  To: `whatsapp:${to}`,
  Body: body,
  NumMedia: "0",
};
const signature = twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, url, params);
const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature },
  body: new URLSearchParams(params),
});
console.log("status", res.status);
