# Ostra Phase 12: Follow-ups for enquiries that go quiet

> **For Devin:** read `OSTRA_PLAN_ADDENDUM_ENQUIRIES.md` (Phase 12), `OSTRA_PHASE6_MESSAGES.md`, `OSTRA_PHASE9_HARDENING.md` and this file. This file **replaces** Phase 12 in the addendum where they differ. Complete **Phase 12 only**, in one PR, and meet every acceptance criterion in section 14.

## 0. Prerequisite check (do this first, and stop if it fails)

Follow-ups only make sense once strangers can ask about dates and prices. This phase **requires** the enquiry work from the addendum, which is not covered by Phases 1-11 of the main plan:

- the availability and pricing engine (`getAvailability`, `Rate`, apartment capacity and price fields),
- the enquiry assistant with its tools (`check_availability`, `save_lead_details`, `handoff_to_host`) replacing the Phase 7 `handleUnmatched`,
- the `Lead` and `LeadMessage` models and the lead inbox with the statuses `NEW, QUOTED, NEEDS_HOST, BOOKED, LOST`.

**Check that these exist in the repository.** If any is missing, do not improvise: stop, and tell the owner that the enquiry phases (called E1 to E3, or addendum Phases 8 to 10) must be built first. Section 1 lists exactly what this phase assumes about them.

## 0.1 Decisions that shape the code

1. **Free-form messages only, never templates.** WhatsApp allows a free-form message within 24 hours of the person's last message. After that, a business-initiated message needs an approved template and the person's opt-in for that kind of message. A stranger who asked about dates has not opted in to marketing-style templates. So a follow-up goes out **only while the reply window is still open**; otherwise it is **not sent** and the lead is shown to the host as "went quiet, window closed".
2. **Exactly one follow-up per quote, at most two per lead.** Never a sequence, never a drip campaign.
3. **Never nudge someone towards something that is no longer true.** Before sending, availability and price are checked again. If the dates are taken or the price changed, nothing is sent and the host sees why.
4. **The host stays in control.** If the host has already replied, nothing is sent. A global switch (off by default) and a per-lead switch exist. The text is hers and translated by the same system as the other messages.
5. **STOP always wins.** Opt-out (the exact word or any language, detected by the model) blocks all further automatic contact with that number, for bookings **and** leads, and survives deletion of data via the hashed opt-out list from Phase 9.
6. **At most once.** A follow-up is claimed atomically before sending and never retried; a failure is recorded and shown to the host.
7. **Every quiet lead ends with a recorded outcome** (sent, or skipped with a reason), so nothing is evaluated forever and the host can see what happened.
8. **Lead data follows the same data-protection rules** as guest data: deleted 90 days after last contact (host setting 30-730), included in erasure and export.
9. Kill switches, usage caps and logging rules from Phase 9 apply: `AUTOMATIC_MESSAGES_ENABLED=false` stops follow-ups, nothing personal is logged.

## 1. What this phase assumes about the enquiry models (adapt names if they differ, keep the meaning)

```prisma
// From the addendum, already present:
model Lead {
  id String @id; ownerId String; phone String; name String?
  status LeadStatus            // NEW QUOTED NEEDS_HOST BOOKED LOST
  checkIn DateTime?; checkOut DateTime?; guests Int?
  apartmentId String?; quotedCents Int?
  lastInboundAt DateTime       // time of the lead's last message
  language String?             // added by the multilingual changes
  messages LeadMessage[]
  @@unique([ownerId, phone])
}
model LeadMessage {
  id String @id; leadId String; direction Direction; body String; escalated Boolean; createdAt DateTime
}
```
`getAvailability(ownerId, { checkIn, checkOut, guests, apartmentId })` returns, per apartment, `{ apartmentId, available, totalCents? }`. When the assistant quotes, it sets `status = QUOTED` and stores `quotedCents`, `checkIn`, `checkOut`, `guests`, `apartmentId`; use exactly the same values here when re-checking.

## 2. Schema (migration `phase12_follow_ups`)

```prisma
enum FollowUpOutcome {
  SENT
  SKIPPED_WINDOW        // the 24-hour window closed before a good moment
  SKIPPED_UNAVAILABLE   // the dates were taken meanwhile
  SKIPPED_PRICE         // the price changed since the quote
  SKIPPED_HOST_REPLIED  // the host answered personally
  SKIPPED_OPT_OUT
  SKIPPED_DISABLED      // follow-ups off for this lead or for this owner
  SKIPPED_LIMIT         // two follow-ups already, or the daily cap
  FAILED
}

enum MessageType {
  // add:
  LEAD_FOLLOW_UP        // a template type only. Never scheduled, never sent through WhatsApp templates
}

model Lead {
  // add:
  doNotContact      Boolean   @default(false)
  doNotContactAt    DateTime?
  followUpDisabled  Boolean   @default(false)   // host switched it off for this lead
  followUpOutcome   FollowUpOutcome?            // outcome for the current quote; null = not decided yet
  followUpClaimedAt DateTime?
  followUpSentAt    DateTime?
  followUpCount     Int       @default(0)
  lastOutboundAt    DateTime?
  lostReason        String?
  @@index([status, followUpOutcome, lastInboundAt])
}

model LeadMessage {
  // add (if the enquiry phases did not already):
  author MessageAuthor?          // GUEST, AI, HOST, SYSTEM
}

model Owner {
  // add:
  leadFollowUpsEnabled Boolean @default(false)   // the host turns it on
  leadFollowUpMaxPerDay Int    @default(30)
}
```
Phase 6 code that loops over `MessageType` for scheduling must keep using an explicit list of the four scheduled types (`SCHEDULED_TYPES`), and `ensureDefaultTemplates` must create `LEAD_FOLLOW_UP` as well (separate list `TEMPLATE_TYPES`). Add to `lib/templates.ts`:

```ts
TEMPLATE_VARS.LEAD_FOLLOW_UP = ["guestName", "apartmentName", "checkInDate", "checkOutDate"];
TEMPLATE_CATEGORY.LEAD_FOLLOW_UP = "MARKETING";  // informational only, it is never submitted to WhatsApp
DEFAULT_TEMPLATES.LEAD_FOLLOW_UP =
  "Hello {{guestName}}, just checking whether you would like to go ahead with {{apartmentName}} from {{checkInDate}} to {{checkOutDate}}. I am happy to answer any questions. Reply STOP if you would rather not hear from us.";
```
`buildValues` gets a `checkOutDate` entry (localised like `checkInDate`). The Phase 6 settings page shows `LEAD_FOLLOW_UP` as a fifth card **without** the "Request approval" and approval-status controls (free-form messages need no approval) and with the explanation in section 9.

## 3. The decision function (pure): `src/lib/lead-follow-up.ts`

```ts
import type { FollowUpOutcome, LeadStatus } from "@prisma/client";
import { inAllowedWindow } from "./send-time";

const H = 3_600_000;
export const AFTER_HOURS = Number(process.env.LEAD_FOLLOW_UP_AFTER_HOURS ?? 16); // wait this long after the lead's last message
export const WINDOW_HOURS = 23;       // free-form is allowed for 24 hours; stop one hour early
export const MAX_FOLLOW_UPS = 2;

export type FollowUpInput = {
  status: LeadStatus;
  hasQuote: boolean;
  followUpOutcome: FollowUpOutcome | null;
  followUpCount: number;
  doNotContact: boolean;
  followUpDisabled: boolean;
  phoneOptedOut: boolean;
  lastInboundAt: Date;
  lastMessage: { direction: "INBOUND" | "OUTBOUND"; author: "GUEST" | "AI" | "HOST" | "SYSTEM" | null } | null;
};

export type Decision =
  | { action: "IGNORE" }     // not this job's business (not quoted, already decided, lead replied)
  | { action: "WAIT" }       // too early, or outside allowed hours: look again next run
  | { action: "SEND" }
  | { action: "SKIP"; outcome: FollowUpOutcome };

export function evaluateFollowUp(l: FollowUpInput, now: Date): Decision {
  if (l.status !== "QUOTED" || !l.hasQuote || l.followUpOutcome !== null) return { action: "IGNORE" };
  if (l.lastMessage?.direction === "INBOUND") return { action: "IGNORE" };         // the lead wrote last: not quiet
  if (l.doNotContact || l.phoneOptedOut) return { action: "SKIP", outcome: "SKIPPED_OPT_OUT" };
  if (l.followUpDisabled) return { action: "SKIP", outcome: "SKIPPED_DISABLED" };
  if (l.followUpCount >= MAX_FOLLOW_UPS) return { action: "SKIP", outcome: "SKIPPED_LIMIT" };
  if (l.lastMessage?.direction === "OUTBOUND" && l.lastMessage.author === "HOST") {
    return { action: "SKIP", outcome: "SKIPPED_HOST_REPLIED" };
  }
  const quiet = now.getTime() - l.lastInboundAt.getTime();
  if (quiet < AFTER_HOURS * H) return { action: "WAIT" };
  if (quiet > WINDOW_HOURS * H) return { action: "SKIP", outcome: "SKIPPED_WINDOW" };
  if (!inAllowedWindow(now)) return { action: "WAIT" }; // 08:00-21:00 Malta only
  return { action: "SEND" };
}
```
With the defaults, the send window is 16 to 23 hours after the lead's last message. A lead who wrote between about 05:00 and 09:00 may fall into the night and be skipped with `SKIPPED_WINDOW`; that is accepted and visible to the host (section 8).

## 4. The job: `src/lib/lead-follow-up-job.ts`

```ts
import { prisma } from "./db";
import { evaluateFollowUp, AFTER_HOURS } from "./lead-follow-up";
import { getAvailability } from "./availability";            // from the enquiry phases
import { buildValues, formatDateLocal } from "./message-render";
import { fillTemplate } from "./templates";
import { translateTemplate } from "./translate";
import { phoneIsOptedOut } from "./optout";
import { automaticMessagesEnabled } from "./flags";
import { sendWhatsApp, WhatsAppError } from "./whatsapp";
import { log } from "./log";

const H = 3_600_000;
const STUCK_MS = 15 * 60_000;

export async function runLeadFollowUps(now = new Date()) {
  const out = { checked: 0, sent: 0, skipped: 0, failed: 0 };
  if (!automaticMessagesEnabled()) return out;

  // A claim that never finished may or may not have sent. Record it as uncertain, never retry.
  await prisma.lead.updateMany({
    where: { followUpClaimedAt: { lt: new Date(now.getTime() - STUCK_MS) }, followUpOutcome: null },
    data: { followUpOutcome: "FAILED" },
  });

  const leads = await prisma.lead.findMany({
    where: {
      status: "QUOTED", followUpOutcome: null, followUpClaimedAt: null,
      owner: { leadFollowUpsEnabled: true },
      lastInboundAt: { lte: new Date(now.getTime() - AFTER_HOURS * H) },
    },
    include: { owner: true, messages: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } },
    take: 200,
  });

  for (const lead of leads) {
    out.checked++;
    const last = lead.messages[0] ?? null;
    const decision = evaluateFollowUp({
      status: lead.status, hasQuote: lead.quotedCents != null && !!lead.checkIn && !!lead.checkOut && !!lead.apartmentId,
      followUpOutcome: lead.followUpOutcome, followUpCount: lead.followUpCount,
      doNotContact: lead.doNotContact, followUpDisabled: lead.followUpDisabled,
      phoneOptedOut: await phoneIsOptedOut(lead.ownerId, lead.phone),
      lastInboundAt: lead.lastInboundAt,
      lastMessage: last && { direction: last.direction, author: last.author },
    }, now);

    if (decision.action === "IGNORE" || decision.action === "WAIT") continue;
    if (decision.action === "SKIP") { await finish(lead.id, decision.outcome); out.skipped++; continue; }

    // Daily cap per owner.
    const sentToday = await prisma.lead.count({
      where: { ownerId: lead.ownerId, followUpSentAt: { gte: new Date(now.getTime() - 24 * H) } },
    });
    if (sentToday >= lead.owner.leadFollowUpMaxPerDay) continue; // try again later, the window may still be open

    // Claim atomically: two runs can never take the same lead.
    const claimed = await prisma.lead.updateMany({
      where: { id: lead.id, followUpClaimedAt: null, followUpOutcome: null },
      data: { followUpClaimedAt: now },
    });
    if (claimed.count === 0) continue;

    // Never nudge towards something that is no longer true.
    const [avail] = await getAvailability(lead.ownerId, {
      checkIn: lead.checkIn!, checkOut: lead.checkOut!, guests: lead.guests ?? 1, apartmentId: lead.apartmentId!,
    });
    if (!avail?.available) { await finish(lead.id, "SKIPPED_UNAVAILABLE"); out.skipped++; continue; }
    if (avail.totalCents !== lead.quotedCents) { await finish(lead.id, "SKIPPED_PRICE"); out.skipped++; continue; }

    try {
      const text = await renderFollowUp(lead);
      await sendWhatsApp({ to: lead.phone, text, ownerId: lead.ownerId, kind: "WA_FREEFORM" }); // free-form only, never a template
      await prisma.$transaction([
        prisma.leadMessage.create({ data: { leadId: lead.id, direction: "OUTBOUND", author: "SYSTEM", body: text } }),
        prisma.lead.update({
          where: { id: lead.id },
          data: { followUpOutcome: "SENT", followUpSentAt: now, followUpCount: { increment: 1 }, lastOutboundAt: now },
        }),
      ]);
      out.sent++;
    } catch (e) {
      log("warn", "lead.follow_up.failed", { feedId: lead.id, code: e instanceof WhatsAppError ? e.code : undefined });
      await finish(lead.id, "FAILED");
      out.failed++;
    }
  }
  return out;
}

const finish = (leadId: string, outcome: Parameters<typeof prisma.lead.update>[0]["data"]["followUpOutcome"]) =>
  prisma.lead.update({ where: { id: leadId }, data: { followUpOutcome: outcome } });

/** The host's own text, in the lead's language. Translation is generated once and stored. */
async function renderFollowUp(lead: {
  ownerId: string; name: string | null; language: string | null; checkIn: Date | null; checkOut: Date | null;
  apartmentId: string | null; owner: { hostLanguage: string; defaultGuestLanguage: string; fallbackLanguage: string };
}): Promise<string> {
  const lang = lead.language ?? lead.owner.defaultGuestLanguage;
  const template = await prisma.messageTemplate.findUniqueOrThrow({
    where: { ownerId_type: { ownerId: lead.ownerId, type: "LEAD_FOLLOW_UP" } },
    include: { translations: true },
  });
  const apartment = await prisma.apartment.findUniqueOrThrow({ where: { id: lead.apartmentId! } });
  let row = template.translations.find((t) => t.language === lang);
  if (!row) {
    try {
      const body = await translateTemplate("LEAD_FOLLOW_UP", template.body, lead.owner.hostLanguage, lang, { ownerId: lead.ownerId, kind: "AI_TEMPLATE" });
      row = await prisma.templateTranslation.create({
        data: { templateId: template.id, language: lang, body, sourceHash: "auto" },
      });
    } catch {
      row = template.translations.find((t) => t.language === lead.owner.fallbackLanguage)
        ?? template.translations.find((t) => t.language === lead.owner.hostLanguage);
    }
  }
  const values = {
    ...buildValues({ guestName: lead.name, checkIn: lead.checkIn!, checkOut: lead.checkOut! }, apartment, row!.language),
    checkOutDate: formatDateLocal(lead.checkOut!.toISOString().slice(0, 10), row!.language),
  };
  return fillTemplate(row!.body, values);
}
```
Use the same date-to-`YYYY-MM-DD` convention the enquiry phases used when storing `checkIn` and `checkOut` (if they store Malta-midnight instants, convert with `maltaYmd`). Lead names are first names only.

**Endpoint:** `POST /api/cron/lead-follow-ups` (cron secret, `withJobRun`), body returns the counts. Railway cron service `cron-lead-follow-ups`, schedule `*/15 * * * *`, command `node scripts/run-cron.mjs lead-follow-ups`, with a heartbeat ping. Add its freshness (no success for 45 minutes) to the Phase 9 self-check.

## 5. Auto-closing stale quotes: `src/lib/lead-lifecycle.ts`
A second small step in the same job run (counts reported separately):
- `status = QUOTED`, no message from the lead for **7 days**, and `followUpOutcome` decided (any value) → `status = LOST`, `lostReason = "No reply"`.
- `status = NEW` with no host or assistant reply for 7 days → left alone (those need the host, and the "needs you" reminders already cover them).
- A new message from a `LOST` lead reopens it: the enquiry handler sets `status = NEW` (or `QUOTED` again when the assistant quotes) and clears `lostReason`. When the assistant produces a **new quote**, it also resets `followUpOutcome = null` and `followUpClaimedAt = null` so that quote can receive its one follow-up (the cap of two per lead still applies).

## 6. Opt-out for leads (changes to existing code)
- **Exact keyword:** in the enquiry handler (the one replacing `handleUnmatched`), run `isStopKeyword(body)` before any AI call. If true: `optOutPhone(ownerId, phone)`, send the localised confirmation, store the messages, stop.
- **Any language:** add a tool `mark_do_not_contact` to the enquiry assistant (no arguments). When the model calls it, the handler runs the same opt-out and sends the model's short confirmation. The prompt line: "If the person asks not to be contacted or to stop messages, call mark_do_not_contact and confirm briefly in their language."
- **`optOutPhone` (Phase 6, extended):** also sets `doNotContact = true`, `doNotContactAt = now`, `followUpOutcome = SKIPPED_OPT_OUT` where `followUpOutcome` is null, on every `Lead` of that owner with the phone, and adds the hashed `OptOut` row as already specified in Phase 9.
- **`phoneIsOptedOut`** (Phase 5, 6, 9) already checks bookings and the hash list; the follow-up job uses it.
- A person who has opted out can still **write** and receive replies to their own questions (they started the conversation); no automatic follow-up is ever sent.

## 7. Retention, erasure and export for leads (extends Phase 9)
- `runRetention`: for each owner, delete `Lead` rows (messages cascade) whose latest contact (`max(lastInboundAt, lastOutboundAt)`) is older than the owner's retention days, regardless of status (a converted lead already lives on as a booking with its own retention). Report the count in the job summary.
- `eraseGuestData(scope: "phone")`: also deletes the owner's leads with that phone.
- `collectGuestData`: includes the leads and lead messages for the phone.
- `UnmatchedMessage` handling stays as is for numbers the enquiry assistant has not taken over.
- Update `docs/DATA_PROTECTION.md` (record of processing and retention table: enquiry leads, 90 days after last contact), `/privacy`, and the guest notice text with one sentence: "If you contact us to ask about availability, we keep your messages for up to 90 days."

## 8. UI
- **Settings, Messages page:** the fifth card **"Follow-up for quiet enquiries"** with a switch (`leadFollowUpsEnabled`, off by default) and the explanation: "Sent once, about 16 hours after you quoted a price, if the person has not replied and WhatsApp still allows a free message (24 hours). Never sent if the dates are no longer available, the price changed, you already replied, or the person asked to stop." Text editor and translations like the other cards (no approval controls). Daily maximum field (`leadFollowUpMaxPerDay`, 0-200).
- **Lead inbox (E3):** each lead shows the follow-up state: "Follow-up sent 3 Nov 14:05", "Not sent: the 24-hour window closed", "Not sent: dates no longer available", "Not sent: price changed", "Not sent: you replied", "Not sent: asked to stop", or "Follow-up failed". A toggle **Do not follow up** (`followUpDisabled`). A **Went quiet** tab lists `QUOTED` leads with no reply for more than 24 hours, newest first, with the outcome reason, so the host can write personally (using the existing lead reply flow when the window is open). `SKIPPED_UNAVAILABLE` and `SKIPPED_PRICE` rows carry an amber badge: "Check this enquiry".
- **Status page and usage page:** an **Enquiries this month** card: new, quoted, follow-ups sent, replies within 48 hours of a follow-up, booked, lost, and outcome counts. (Replies after follow-up: count leads with an inbound message created after `followUpSentAt`; booked: status `BOOKED`.) Owner-scoped.
- **Attention panel:** leads with outcome `FAILED`, `SKIPPED_UNAVAILABLE` or `SKIPPED_PRICE` from the last 3 days link to the lead.

## 9. Documents
- `docs/RUNBOOK.md`: how to switch follow-ups off (owner setting, or `AUTOMATIC_MESSAGES_ENABLED=false`), what a failed or uncertain follow-up means, how to confirm none were sent twice.
- `docs/HOST_GUIDE.md` (or the onboarding material): a short explanation for the host of when a follow-up is sent and when it is not.

## 10. Tests

**Unit tests (no database)**
- `evaluateFollowUp` for each branch and boundary: not quoted, no quote data, outcome already set, lead wrote last (`IGNORE`); opted out, per-lead disable, two follow-ups already, host replied (`SKIP` with the right outcome); 15h59m `WAIT`, exactly 16h `SEND` (inside allowed hours), 22h59m `SEND`, 23h01m `SKIP_WINDOW`; within time but outside 08:00-21:00 Malta gives `WAIT`; across the October and March clock changes; the order of checks (an opted-out lead whose window also closed reports `SKIPPED_OPT_OUT`).
- `renderFollowUp` variable fill: all four variables replaced, first name only, `👋` when the name is unknown, dates localised in `en`, `de`, `ar`, `mt`; no unreplaced `{{` remains.
- `validateTemplate("LEAD_FOLLOW_UP", ...)` accepts the default, rejects unknown variables and a leading or trailing variable.

**Database tests (test database; mock `@/lib/whatsapp`, `@/lib/translate`, `@/lib/availability`)**
1. A quoted lead silent for 17 hours in allowed hours with an open window gets exactly one free-form message, a `LeadMessage` with author `SYSTEM`, `followUpOutcome = SENT`, `followUpSentAt`, `followUpCount = 1`; **`sendWhatsApp` is called without a template** and never in any other form.
2. Running the job twice, and two runs at the same time (`Promise.all`), send once.
3. Skips with the right outcome: dates no longer available, price changed, host replied after the quote, opted out (flag and hashed list), per-lead disable, owner switch off (no outcome, no send), two follow-ups already, daily cap (stays undecided and is retried), kill switch `AUTOMATIC_MESSAGES_ENABLED=false` (nothing happens and nothing is recorded).
4. Window: lead silent for 24 hours gets `SKIPPED_WINDOW` and nothing is sent; a lead whose 16-23 hour period lies entirely in the night is skipped with `SKIPPED_WINDOW`; a lead who replies at hour 15 is ignored and evaluated again after the next quote.
5. A failing send records `FAILED`, sends nothing twice, and does not retry on the next run; a claim older than 15 minutes with no outcome becomes `FAILED`.
6. Language: lead language with an existing translation is used; a missing translation is generated once and stored (the second follow-up reuses it); a translation failure or exceeded AI budget falls back to the owner's fallback or host language; the sent text contains no template placeholders.
7. Lifecycle: `QUOTED` with 7 days of silence becomes `LOST` with `lostReason = "No reply"`; `NEW` leads are untouched; a message from a `LOST` lead reopens it; a new quote resets the follow-up fields and allows one more follow-up, but never a third.
8. Opt-out: exact `STOP` from a lead calls `optOutPhone`, sends the confirmation and never calls the AI; the model's `mark_do_not_contact` does the same; `optOutPhone` sets `doNotContact` on all of that owner's leads with the phone, sets the outcome where undecided, and does not touch other owners' leads.
9. Retention, erasure, export: leads past the owner's retention days are deleted with their messages (all statuses); newer leads and other owners' leads are untouched; erasure by phone removes leads; export includes leads and lead messages; audit rows contain no personal data.
10. Owner scoping everywhere: settings, per-lead toggle and the Went quiet tab show only the owner's leads; actions on another owner's lead give `notFound`.
11. The cron route returns 401 without the secret, 200 with it, records a `JobRun` with counts only; the self-check flags a stale `lead-follow-ups` job.
12. Logging: spy on `log` and `console`; no phone numbers, names or message text appear.

**Manual checks**
1. In dry-run, simulate an enquiry with the Phase 7 script, let the assistant quote, then set the lead's `lastInboundAt` back 17 hours in the database and run the cron script: one follow-up appears in the lead's messages.
2. Repeat after booking the same dates for someone else: no follow-up, outcome "dates no longer available", amber badge in the inbox.
3. Reply `STOP` (and a natural-language request in another language): confirmation, no follow-up, opt-out visible for all of that number's leads.
4. Change the rate for the dates and check the "price changed" outcome; reply personally as the host and check "you replied".
5. Check the funnel card and the Went quiet tab on a phone.

## 11. Acceptance criteria
- A quoted lead who stays silent receives **at most one** follow-up per quote (never more than two in total), only as a free-form message inside the open 24-hour window, only between 08:00 and 21:00 Malta time, never as a template.
- Nothing is sent when the dates are gone, the price changed, the host replied, the person opted out, the feature is off, or the kill switch is on; each of these leaves a visible, recorded reason.
- STOP in any language blocks all automatic contact with that number for leads and bookings and survives data deletion.
- Follow-ups are sent exactly once even with concurrent job runs, and failures are never retried.
- Quiet quotes close as lost after 7 days and reopen when the person writes again.
- Lead data is covered by retention, erasure and export, and the privacy documents mention it.
- The host can switch follow-ups off globally and per lead, edit the text, and sees the outcome and the funnel numbers on her phone.
- Everything is owner-scoped; nothing personal is logged; `npm run lint`, `typecheck`, `test`, `build` pass; the migration applies on a fresh database.

## 12. Not in this phase
- Template-based follow-ups outside the 24-hour window, multi-step sequences, follow-ups by email, review replies and the weekly summary (Phase 13), and any marketing to past guests.
