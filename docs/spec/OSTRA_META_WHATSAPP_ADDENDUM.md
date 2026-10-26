# Ostra: Meta WhatsApp Cloud API addendum (replaces Twilio)

> **For Devin:** this document **overrides every Twilio statement** in `OSTRA_PHASE6_MESSAGES.md`, `OSTRA_PHASE7_ASSISTANT.md`, `OSTRA_PHASE8_INBOX.md`, `OSTRA_PHASE9_HARDENING.md`, `OSTRA_PHASES_E1_E3_ENQUIRIES.md`, `OSTRA_PHASE12_FOLLOW_UPS.md` and `OSTRA_MASTER_GUIDE.md`. A first migration already exists in the repository. **Do not rewrite it blindly: compare it against this document, fix every deviation, and report each one.** Everything not mentioned here (windows, opt-in, templates without secrets, idempotency, caps, language rules) stays as written in those phases.

## 0. Verified facts this design relies on
- Webhook setup is a `GET` handshake with `hub.mode`, `hub.verify_token` and `hub.challenge`; the endpoint must return the raw challenge value (not JSON) only when the token matches.
- Every `POST` carries `X-Hub-Signature-256: sha256=<hex>`, an HMAC-SHA256 of the **raw request body** keyed with the **Meta app secret**. Meta escapes unicode, so re-serialised JSON fails the check. The verify token, the app secret, the access token, the WhatsApp Business Account ID and the phone number ID are five different values and must never be confused or reused.
- Inbound messages and delivery statuses arrive on the same URL: `value.messages[]` for messages and `value.statuses[]` for `sent`, `delivered`, `read`, `failed`. Message ids (`wamid...`) are the idempotency keys. Process after acknowledging quickly.
- Since 1 July 2025 pricing is **per message**: free-form replies inside the 24-hour window are free, utility templates inside an open window are free, templates outside the window are charged by category and country. Meta changes rates only at the start of a quarter. Check the current rate card for Malta and the guests' countries.
Things I could not confirm and you must check in Meta's current documentation before relying on them: the Graph API version to pin, the exact error-code list, template language support, messaging limits and tiers for new numbers, and the number of recipients the test number allows.

## 1. Manual setup (the owner does this; Devin documents it in `docs/RUNBOOK.md`)
1. A verified Meta Business account; a Meta developer app with the WhatsApp product; a WhatsApp Business Account (WABA).
2. A **dedicated** phone number registered to the WABA (not a number used in the normal WhatsApp app); display name approved.
3. A **system user** with a **permanent access token** that has the WhatsApp messaging and management permissions. A temporary token from the dashboard expires within about a day and must never be used in production.
4. App secret (App settings, Basic). Choose a random **webhook verify token**.
5. Configure the webhook: callback URL `${APP_URL}/api/webhooks/meta`, the verify token, and subscribe the app to the WABA with the webhook fields `messages` and `message_template_status_update` (optionally `phone_number_quality_update` and `account_update`).
6. **Testing:** Meta provides a test phone number. It sends real messages, but only to a short list of recipient numbers you add in the dashboard (check the current limit). Use it with `WHATSAPP_MODE=sandbox`.

## 2. Environment and configuration
Remove all `TWILIO_*` variables. Add (to `.env.example` and the master guide):
```
META_API_VERSION=            # pin a Graph API version, bump deliberately (check Meta's changelog)
META_ACCESS_TOKEN=           # permanent system-user token
META_APP_SECRET=             # signs webhook POSTs
META_WEBHOOK_VERIFY_TOKEN=   # only for the GET handshake
META_WABA_ID=                # needed for template management
META_PHONE_NUMBER_ID=        # the number used to send (test number in sandbox)
META_SANDBOX_ALLOWED_NUMBERS=   # comma-separated E.164 numbers, sandbox only
WHATSAPP_MODE=dry-run        # dry-run | sandbox | production
```
**Modes (replaces the Twilio meaning):** `dry-run` makes no network calls and records messages as sent. `sandbox` calls the real Meta API but **refuses any recipient not listed in `META_SANDBOX_ALLOWED_NUMBERS`** (so test credentials can never message a real guest by mistake). `production` has no allow-list. Both live modes require all `META_*` variables and fail loudly at startup if one is missing. The mode still defaults to `dry-run`.

## 3. Schema (migration `meta_whatsapp`)
Fix what the first migration did (a field renamed in Prisma but mapped to the old column name leaves the schema lying about its content):
```prisma
model Message          { metaMessageId String? @unique }   // was twilioSid, rename the COLUMN too
model LeadMessage      { metaMessageId String? @unique }
model UnmatchedMessage { metaMessageId String  @unique }

model Owner {
  whatsappPhoneNumberId String? @unique   // routes inbound webhooks (replaces routing by the display number)
}

model TemplateTranslation {
  // replace contentSid:
  metaTemplateName String?     // lowercase letters, digits and underscores
  metaTemplateId   String?
  metaCategory     String?     // category Meta actually assigned, which may differ from the requested one
}
```
Migration SQL uses `ALTER TABLE ... RENAME COLUMN "twilioSid" TO "metaMessageId"` (and the same for `contentSid`), not `@map`. Delivery status values stay `queued, sent, delivered, read, failed, dry-run`.

## 4. Webhook: `src/app/api/webhooks/meta/route.ts`
```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { handleMetaPayload } from "@/lib/meta-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Meta's subscription handshake.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  if (q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return new Response(q.get("hub.challenge") ?? "", { status: 200 });   // the raw value, never JSON
  }
  return new Response("Forbidden", { status: 403 });
}

export function validSignature(raw: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", process.env.META_APP_SECRET!).update(raw, "utf8").digest("hex");
  const given = header.slice(7);
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
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
```
Delete the separate `meta-status` route: statuses arrive on this same URL.

**`src/lib/meta-webhook.ts` (`handleMetaPayload`)** iterates `entry[].changes[]` and dispatches on `field`:
- `messages`: `value.metadata.phone_number_id` selects the owner (`Owner.whatsappPhoneNumberId`; unknown ids are ignored). For each item in `value.messages[]` call `processInbound` (Phase 7) with: `sid = id`, `from = "+" + from` (Meta sends digits without the plus sign), `body` and `hasMedia` derived as below. For each item in `value.statuses[]` update delivery status.
- `message_template_status_update`: update the matching `TemplateTranslation` (by `message_template_id`, falling back to name and language): events approved become `APPROVED`, rejected become `REJECTED` with the `reason`, paused or disabled become `NONE` (never sent) and are shown to the host; record the category Meta reports.
- anything else: ignore.

**Message type mapping:**
| `type` | Result |
|---|---|
| `text` | `body = text.body` |
| `button` (reply to a template quick reply) | `body = button.text` |
| `interactive` | `body = interactive.button_reply.title` or `list_reply.title` |
| `image`, `audio`, `video`, `document`, `sticker`, `location`, `contacts` | `body = ""`, `hasMedia = true` (Phase 7 hands these to the host; **nothing is downloaded**) |
| `reaction`, `unsupported`, others | ignored |

**Statuses:** map `sent, delivered, read, failed`; keep Phase 6's ranking so an out-of-order `sent` after `delivered` never downgrades; for `failed` store `errors[0].code`; unknown statuses are ignored. Update `Message` and `LeadMessage` by `metaMessageId`.

**Batching:** one POST can contain several messages and statuses, possibly for different phone numbers. Process each item independently so one failure never drops the others, and keep idempotency on `wamid`.

Do not store the sender's WhatsApp profile name (`contacts[].profile.name`).

## 5. Sending: `src/lib/whatsapp.ts`
```ts
import type { UsageKind } from "@prisma/client";
import { recordUsage } from "./usage";

export type WhatsAppMode = "dry-run" | "sandbox" | "production";
export const whatsappMode = (): WhatsAppMode => {
  const m = process.env.WHATSAPP_MODE;
  return m === "sandbox" || m === "production" ? m : "dry-run";
};

export type ErrorKind = "TOKEN" | "WINDOW" | "RECIPIENT" | "TEMPLATE" | "RATE" | "SANDBOX" | "OTHER";
export class WhatsAppError extends Error {
  constructor(message: string, public permanent: boolean, public kind: ErrorKind = "OTHER", public code?: number) { super(message); }
}

export type SendInput = {
  to: string;                                                     // E.164 with the plus sign
  text: string;                                                   // rendered text (free-form body, and our own record)
  template?: { name: string; language: string; bodyParams: string[] };
  ownerId?: string; kind?: UsageKind;
};

const digits = (e164: string) => e164.replace(/^\+/, "");
const graph = (path: string) => `https://graph.facebook.com/${process.env.META_API_VERSION}/${path}`;

// Codes to check against Meta's current error reference. Anything not listed is "OTHER", permanent only for 4xx.
const CODES: Record<number, { kind: ErrorKind; permanent: boolean }> = {
  190: { kind: "TOKEN", permanent: true },        // invalid or expired access token: alert the operator
  131047: { kind: "WINDOW", permanent: true },    // more than 24 hours since the user's last message
  131026: { kind: "RECIPIENT", permanent: true }, // undeliverable (for example not on WhatsApp)
  131030: { kind: "SANDBOX", permanent: true },   // recipient not in the allowed list of the test number
  132000: { kind: "TEMPLATE", permanent: true },  // parameter count mismatch
  132001: { kind: "TEMPLATE", permanent: true },  // template does not exist in that language
  130429: { kind: "RATE", permanent: false },
  131056: { kind: "RATE", permanent: false },
};

export async function sendWhatsApp(input: SendInput): Promise<{ id: string | null }> {
  const mode = whatsappMode();
  if (mode === "dry-run") return { id: null };

  if (mode === "sandbox") {
    const allowed = (process.env.META_SANDBOX_ALLOWED_NUMBERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!allowed.includes(input.to)) throw new WhatsAppError("Recipient not allowed in sandbox mode.", true, "SANDBOX");
  }

  const base = { messaging_product: "whatsapp", recipient_type: "individual", to: digits(input.to) };
  const body = input.template
    ? {
        ...base, type: "template",
        template: {
          name: input.template.name, language: { code: input.template.language },
          components: [{ type: "body", parameters: input.template.bodyParams.map((text) => ({ type: "text", text })) }],
        },
      }
    : { ...base, type: "text", text: { body: input.text, preview_url: false } };

  let res: Response;
  try {
    res = await fetch(graph(`${process.env.META_PHONE_NUMBER_ID}/messages`), {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // The request may have reached Meta. NEVER retry automatically: the caller records an uncertain send.
    throw new WhatsAppError("No response from WhatsApp.", false, "OTHER");
  }
  const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { code?: number } };
  if (!res.ok) {
    const code = json.error?.code;
    const known = code !== undefined ? CODES[code] : undefined;
    throw new WhatsAppError(
      "WhatsApp rejected the request.",                       // never put the response text, token or number in messages
      known ? known.permanent : res.status >= 400 && res.status < 500 && res.status !== 429,
      known?.kind ?? "OTHER", code,
    );
  }
  if (input.ownerId) await recordUsage(input.ownerId, input.kind ?? (input.template ? "WA_TEMPLATE" : "WA_FREEFORM"));
  return { id: json.messages?.[0]?.id ?? null };
}
```
Rules around it:
- **`TOKEN` errors** are an operator emergency: `reportError`, email `OPERATOR_EMAIL` once per hour, and show a red banner on the status page. Sending stops being attempted until the next scheduled run.
- **`WINDOW` errors** should never happen because Ostra checks the window itself; if one occurs, show "the reply window has closed" and do not retry.
- Never log the access token, recipient numbers or message text.

## 6. Templates: `src/lib/template-approval.ts` (Meta instead of the Twilio Content API)
- **Create** `POST /{META_WABA_ID}/message_templates` with `name`, `language`, `category` (`UTILITY` or `MARKETING` from Phase 6's table) and `components: [{ type: "BODY", text, example: { body_text: [[ ...one realistic example per variable... ]] } }]`. Body text uses Meta numbering (`{{1}}`, `{{2}}`) produced by `toTwilioBody` (rename that function `toMetaBody`). Meta requires examples for variables.
- **Names:** lowercase letters, digits and underscores only, for example `ostra_pre_arrival_de_<hash8>`. **Editing text never edits an approved template:** submit a new name with a new hash, keep the old one usable until the new one is approved, then switch.
- **Languages:** map Ostra codes to Meta's template language codes with a small table (`pt` to `pt_PT`, `nb` to `nb`, the others identity) and treat a rejection for an unsupported language as `REJECTED` with the reason; the owner's fallback language then covers those guests.
- **Status:** primarily from the `message_template_status_update` webhook; `syncApprovals()` (hourly) also `GET`s `/{META_WABA_ID}/message_templates?fields=name,status,language,category,id,rejected_reason` and reconciles. Store the category Meta assigned: Meta may reclassify a utility template as marketing, which changes its price and what it may contain; show the host a notice.
- **Send:** production uses `{ name: metaTemplateName, language: whatsappLocale(language), bodyParams }` with the parameters in the order produced by `toMetaBody`; sandbox sends a template when one is approved, otherwise text (which only reaches people inside an open window).
- A template whose status is paused or disabled is treated as not approved.

## 7. Changes per phase
| Document | Change |
|---|---|
| Phase 6 | `sendOne` passes `template` (name, locale, params) in production; `pickTranslation` requires `approval = APPROVED` and `metaTemplateName`; status updates come from `meta-webhook`; `whatsappMode` per section 2 |
| Phase 7 | `processInbound` receives the Meta sid and `+` number; owner routing by phone number ID; `reply()` uses text only; remove the Twilio status route; rewrite `scripts/simulate-inbound.mjs` to post a Meta-shaped payload signed with `META_APP_SECRET` (HMAC over the exact bytes it sends) |
| Phase 8, E2, E3, 12 | Rename sid fields; replies use text inside the window (rules unchanged) |
| Phase 9 | Processor list and `/privacy`: replace Twilio by **Meta Platforms (WhatsApp Business Platform, direct)** and say message content passes through Meta; remove the Twilio spend-limit instruction (Meta has no per-account spend cap, so `monthlyTemplateCap` and a close watch of Meta billing are the protection); the self-check and status page also show the access token health (a cheap `GET` of the phone number object) |
| Master guide | Replace the Twilio rows in the environment table, remove `twilio` from dependencies, and update `AGENTS.md` rule 6 wording ("Meta Cloud API") |

## 8. Tests
**Unit**
- Signature: valid with unicode and escaped characters in the body; invalid; missing header; header without `sha256=`; a body re-serialised from parsed JSON **fails**; timing-safe length mismatch returns false without throwing.
- Handshake: correct token returns the raw challenge as `text/plain`-style body; wrong token or mode returns 403; the challenge is never JSON.
- Payload fixtures (store as files): text, button, interactive button and list reply, image, audio, location, reaction, unsupported, a batch with two messages and two statuses, a status with `failed` and an error code, a template status update, and a payload for an unknown phone number ID. Assert the parsed inputs for each.
- Number handling: `"4915112345678"` becomes `"+4915112345678"`; invalid values are ignored.
- Status ranking never downgrades; unknown statuses ignored.
- `sendWhatsApp` request shapes for text and for a template with two parameters; dry-run makes no `fetch`; sandbox rejects a number outside the allow-list **before** any network call; production has no allow-list; missing `META_*` variables fail loudly.
- Error mapping for each listed code, a 5xx, a 429, a timeout (permanent false, never retried), and a malformed error body; error messages and logs never contain the token, number or body (spy on `log` and `console`).
- Template payload builder: name sanitising, hash suffix on edit, examples count equals variable count, locale mapping, body numbering.

**Database (mock `fetch`)**
- Webhook route: 403 on a bad signature with nothing stored; 200 on valid; the owner is found by phone number ID and two owners never mix; duplicate `wamid` delivered twice (sequentially and concurrently) produces one stored message; a batch containing a bad item still processes the good ones.
- Inbound text reaches `processInbound` and produces an assistant reply sent through the mocked Graph API; STOP and media paths behave as in Phase 7; statuses update `Message` and `LeadMessage`.
- Template status webhook updates approval and category; the hourly sync reconciles a missed webhook; a paused template is not used; production skips a message with the reason "no approved template" while sandbox sends text.
- Migration: the column renames keep existing rows; no `twilio` string remains anywhere in the source, tests, scripts, documents or `package.json` (add a test that greps the repository).
- Token expiry (`190`) triggers one operator alert per hour and the status banner.

**Manual checks**
1. Complete the Meta webhook verification in the dashboard against the deployed URL.
2. In sandbox, message the test number from an allowed phone: you receive the assistant's reply in your language; a status `delivered` and `read` appear on the booking.
3. Send a template to an allowed number outside the window and check the content, language and variables.
4. Reply `STOP` and confirm opt-out; trigger a deliberate token failure in staging and confirm the alert.
5. Leave the window closed for 25 hours and confirm the composer is disabled and a forced send is refused by the server.

## 9. Acceptance criteria
- All WhatsApp traffic goes through the Meta Cloud API; no Twilio code, variable, document or dependency remains.
- Webhook signatures are verified over the raw body; the handshake works; deliveries are idempotent on `wamid`; batches are handled item by item; routing uses the phone number ID.
- Sandbox can never message a number outside its allow-list; dry-run makes no network call; production uses approved templates only for business-initiated messages.
- Template creation, status webhooks, polling, versioned edits and category changes work; paused templates are never sent.
- Token problems alert the operator; secrets, numbers and message text never appear in logs, errors or reports.
- The documents (Phases 6 to 9, E1 to E3, 12, master guide, `AGENTS.md`, runbook, privacy page) all say Meta; `lint`, `typecheck`, `test` and `build` pass on PostgreSQL.
