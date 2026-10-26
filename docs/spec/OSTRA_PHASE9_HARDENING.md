# Ostra Phase 9: Production hardening

> **For Devin:** read `OSTRA_PLAN.md` (Phase 9) and this file. This file **replaces** Phase 9 in the plan where they differ. Complete **Phase 9 only**, in one PR if it stays reviewable, otherwise in the three PRs named in section 14 (9A, 9B, 9C). Meet every acceptance criterion in section 15. Assumes Phases 1-8 are merged. Documents in `docs/` are deliverables, not optional.

## 0. Goals and decisions

Goal: your friend can rely on Ostra with real guests, and you can find out about problems before she does.

1. **Nothing sensitive in logs, errors or emails.** Phone numbers, message text, names and calendar URLs never leave the database except to the processors that need them. Logging uses an **allow-list** of fields, error reports are **scrubbed**, and an ESLint rule forbids raw `console.*`.
2. **Every background job leaves a trace and has a dead-man's switch.** Each cron run is recorded (`JobRun`), a self-check job raises an alert when something is late, and each job pings an external heartbeat URL so silence itself is detected.
3. **Data protection is a feature.** Hosts are the *controllers* of their guests' data; you (the operator) are the *processor*. Retention, erasure, export, a processor list and a data processing agreement template are built in. **This is engineering support, not legal advice; have a Maltese lawyer or the host's adviser review `docs/` before real guests are involved.**
4. **Opt-outs must outlive the data.** When guest data is deleted the phone number goes too, so STOP requests are kept as a **keyed hash** (`OptOut`), which can block a number without storing it.
5. **Money has ceilings.** Monthly AI budget and WhatsApp template cap per owner, visible usage and estimated cost, plus spend limits set at the providers themselves.
6. **Kill switches exist and are documented.** `ASSISTANT_ENABLED`, `AUTOMATIC_MESSAGES_ENABLED`, and `WHATSAPP_MODE=dry-run` as the global stop.
7. **Backups are only real once restored.** Nightly encrypted dumps to separate storage, and a documented, rehearsed restore.
8. **Deleted data must not come back.** After any restore the retention job is run again before the app is reopened.

## 1. Schema (migration `phase9_hardening`)

```prisma
enum UsageKind { AI_REPLY AI_TRANSLATE AI_TEMPLATE WA_TEMPLATE WA_FREEFORM }

model Owner {
  // add:
  retentionDays        Int      @default(90)      // min 30, max 730; host decides as controller
  passwordChangedAt    DateTime?
  monthlyAiBudgetCents Int      @default(1500)    // hard cap on estimated AI cost per calendar month
  monthlyTemplateCap   Int      @default(1000)    // hard cap on template WhatsApp messages per month
  waTemplateCost       Decimal  @default(0) @db.Decimal(8, 4)  // EUR per template message, entered by the host from Twilio's price list
  budgetWarnedMonth    String?                    // "2026-11" once the 80% warning email was sent
}

model Booking {
  // add:
  anonymisedAt DateTime?
}

model OptOut {                 // keyed hash of an opted-out phone number, survives deletion of guest data
  id        String   @id @default(cuid())
  ownerId   String
  phoneHash String
  createdAt DateTime @default(now())
  @@unique([ownerId, phoneHash])
}

model LoginAttempt {           // hashed, deleted after 7 days
  id        String   @id @default(cuid())
  emailHash String
  ipHash    String
  success   Boolean
  createdAt DateTime @default(now())
  @@index([emailHash, createdAt])
  @@index([ipHash, createdAt])
}

model JobRun {
  id         String    @id @default(cuid())
  job        String
  startedAt  DateTime  @default(now())
  finishedAt DateTime?
  ok         Boolean   @default(false)
  summary    String?                      // counts only, never personal data
  @@index([job, startedAt])
}

model AuditLog {               // no personal data in this table
  id         String   @id @default(cuid())
  ownerId    String?
  action     String                       // ERASE_GUEST, EXPORT_GUEST, PASSWORD_CHANGED, RETENTION_RUN, OWNER_EXPORT, ...
  targetType String?
  targetId   String?
  createdAt  DateTime @default(now())
  @@index([ownerId, createdAt])
}

model UsageDaily {
  id           String    @id @default(cuid())
  ownerId      String
  day          DateTime  @db.Date
  kind         UsageKind
  count        Int       @default(0)
  inputTokens  Int       @default(0)
  outputTokens Int       @default(0)
  @@unique([ownerId, day, kind])
}
```
New environment variables (add to `.env.example`, document each in the runbook): `DATA_PEPPER` (long random secret for hashing, never rotated without a plan), `SENTRY_DSN`, `SENTRY_AUTH_TOKEN` (build only), `OPERATOR_EMAIL`, `TRUST_PROXY=1`, `ASSISTANT_ENABLED=true`, `AUTOMATIC_MESSAGES_ENABLED=true`, `AI_INPUT_EUR_PER_MTOK`, `AI_OUTPUT_EUR_PER_MTOK` (copy from the AI provider's current price list; startup logs a warning if missing), `PING_URL_<JOB>` per cron job (optional), `BACKUP_PING_URL`.

## 2. Logging and error reporting

**`src/lib/log.ts`** (the only file allowed to call `console`)
```ts
import { scrub } from "./scrub";

// Only these fields are ever logged. Everything else is dropped, never "redacted": dropping cannot leak.
const ALLOWED = new Set([
  "bookingId", "messageId", "ownerId", "feedId", "scheduledId", "job", "count", "created", "updated",
  "cancelled", "sent", "failed", "skipped", "status", "code", "durationMs", "attempt", "mode", "reason",
]);

export function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!ALLOWED.has(k)) continue;
    safe[k] = typeof v === "string" ? scrub(v).slice(0, 200) : v;
  }
  console[level](JSON.stringify({ t: new Date().toISOString(), level, event, ...safe }));
}
```

**`src/lib/scrub.ts`**
```ts
// Removes phone numbers, emails, calendar/token URLs and long digit runs from any string.
export function scrub(s: string): string {
  return s
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]");
}
```

**Rules**
- Replace every `console.*` in `src/` with `log(...)` or `reportError(...)`. ESLint: `"no-console": "error"` with an override for `src/lib/log.ts` and `scripts/**`.
- `src/lib/report-error.ts`: `reportError(err, { tags })` scrubs the message and tags, then calls `Sentry.captureException`. Use it in every `catch` that previously logged a failure (cron routes, `after()` callbacks, the status webhook, WhatsApp and AI failures).
- **Sentry** (`@sentry/nextjs`, choose the **EU data region** when creating the project): `instrumentation.ts` for the server, client config for the browser, `sendDefaultPii: false`, `tracesSampleRate: 0.1`, `tunnelRoute: "/monitoring"` in `withSentryConfig` (so the CSP stays `connect-src 'self'` and ad blockers do not hide errors). `beforeSend` deletes `event.request.data`, `cookies`, `headers`, `event.user`, runs `scrub` over messages, exception values and breadcrumb messages, and `beforeBreadcrumb` drops console, fetch and XHR breadcrumbs. Source maps are uploaded at build time and not served publicly.
- Middleware must let `/monitoring` through without a session check.

## 3. Jobs, health and alerts

**`src/lib/job-run.ts`**
```ts
import { prisma } from "./db";
import { reportError } from "./report-error";

export async function withJobRun<T extends Record<string, number>>(job: string, fn: () => Promise<T>): Promise<T> {
  const run = await prisma.jobRun.create({ data: { job } });
  try {
    const result = await fn();
    await prisma.jobRun.update({
      where: { id: run.id },
      data: { ok: true, finishedAt: new Date(), summary: JSON.stringify(result).slice(0, 500) }, // counts only
    });
    return result;
  } catch (e) {
    await prisma.jobRun.update({ where: { id: run.id }, data: { ok: false, finishedAt: new Date() } });
    reportError(e, { job });
    throw e;
  }
}
```
Wrap every cron route handler body (`sync-calendars`, `send-scheduled`, `sync-templates`, `escalation-reminders`, plus the new `retention`, `self-check`, `inbound-recovery`) in `withJobRun`. Every job's result must be a flat object of numbers.

**`scripts/run-cron.mjs`**: after a successful call, `GET` the env var `PING_URL_<JOB uppercased, dashes to underscores>` if set; on failure `GET` it with `/fail` appended (Healthchecks-style). This is the external dead-man's switch: configure each ping URL in a heartbeat monitor with a grace period just above the job's interval.

**`GET /api/health`** (public, no data): runs `SELECT 1` with a 2-second timeout; returns `{ ok: true, version: process.env.RAILWAY_GIT_COMMIT_SHA }` with 200, or `{ ok: false }` with 503. Point an uptime monitor at it every minute. Used as the Railway health check too.

**`POST /api/cron/self-check`** (cron secret, every 15 minutes, `withJobRun`): computes the following and, when anything is wrong **and it was not already wrong at the previous run**, emails `OPERATOR_EMAIL` (subject and counts only), and returns the counts:
- last successful run too old: `sync-calendars` over 90 minutes, `send-scheduled` over 30, `escalation-reminders` over 45, `sync-templates` over 3 hours, `retention` over 36 hours, `inbound-recovery` over 20 minutes
- `PENDING` scheduled messages overdue by more than 30 minutes during allowed hours
- `FAILED` scheduled messages in the last 24 hours, outbound messages with `failed` or `undelivered` delivery status in the last 24 hours
- unresolved **urgent** escalations older than 15 minutes
- calendar feeds with `lastError` or no success for 3 hours
- AI or template usage above 80% of the monthly cap
Add the heartbeat ping so a dead self-check is itself detected.

**`POST /api/cron/inbound-recovery`** (every 5 minutes, `withJobRun`): the server can restart while an `after()` task is answering a guest. Find guest messages (`direction INBOUND`, `author GUEST`) older than 3 minutes and newer than 24 hours, not escalated, with **no later OUTBOUND message** in that booking, whose booking has 20 or fewer inbound messages in the last hour (floods are intentionally unanswered). For each: set `escalated = true`, `escalationReason = "No reply was sent (the system restarted). Please answer."`, `hostSummary = "A guest message was not answered automatically. Please reply."`, and notify the host through the existing escalation path. Never re-run the AI automatically (risk of a duplicate reply).

**Railway cron services to add:** `cron-retention` (`30 1 * * *`, i.e. 01:30 UTC, around 02:30-03:30 Malta time), `cron-self-check` (`*/15 * * * *`), `cron-inbound-recovery` (`*/5 * * * *`), `cron-backup` (section 7).

**Status page `/settings/status`** (owner-scoped, read-only): last run of each job with result and age, feeds with last success, counts of failed or skipped messages in the last 7 days, current `WHATSAPP_MODE`, the kill-switch flags, app version. Useful to both of you.

## 4. Security

### 4.1 Headers and CSRF
`next.config.ts`:
```ts
const isDev = process.env.NODE_ENV !== "production";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`, // Next.js inline scripts; a nonce-based CSP is a possible later step
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const headers = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];
// in the config: async headers() { return [{ source: "/:path*", headers }]; }
// experimental: { serverActions: { allowedOrigins: [new URL(process.env.APP_URL!).host], bodySizeLimit: "1mb" } }
```
Server actions already check the `Origin` header; the `allowedOrigins` setting makes that check work behind Railway's proxy. Auth cookies must be `HttpOnly`, `Secure`, `SameSite=Lax` with a 14-day maximum age. No `GET` handler may change data (test below). Add `Cache-Control: no-store` to `/api/export/*` and to authenticated pages that show guest data.

### 4.2 Login protection: `src/lib/login-guard.ts`
```ts
import { createHmac } from "node:crypto";
import { prisma } from "./db";

const hmac = (v: string) => createHmac("sha256", process.env.DATA_PEPPER!).update(v.trim().toLowerCase()).digest("hex");

export function clientIp(headers: Headers): string {
  if (process.env.TRUST_PROXY === "1") {
    const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}

export async function isLockedOut(email: string, ip: string, now = new Date()): Promise<boolean> {
  const [byEmail, byIp] = await Promise.all([
    prisma.loginAttempt.count({ where: { emailHash: hmac(email), success: false, createdAt: { gte: new Date(now.getTime() - 15 * 60_000) } } }),
    prisma.loginAttempt.count({ where: { ipHash: hmac(ip), success: false, createdAt: { gte: new Date(now.getTime() - 60 * 60_000) } } }),
  ]);
  return byEmail >= 5 || byIp >= 20;
}

export async function recordAttempt(email: string, ip: string, success: boolean) {
  await prisma.loginAttempt.create({ data: { emailHash: hmac(email), ipHash: hmac(ip), success } });
}
```
In the credentials `authorize`: if locked out return `null` **without** checking the password; always run `bcrypt.compare` against a dummy hash when the user does not exist (no timing difference); record every attempt; show one generic message for wrong password, unknown email and lockout ("Email or password is wrong, or there were too many attempts. Try again in 15 minutes."). Never reveal which part was wrong.

### 4.3 Password change and session invalidation
- `/settings/password` form (server action): current password, new password twice. Rules: at least 12 characters, not equal to the email or its local part, not in a built-in list of the 200 most common passwords, bcrypt cost 12.
- On success set `passwordChangedAt = now`, write an `AuditLog` row (`PASSWORD_CHANGED`, no password data), and sign the user out.
- Expose the JWT's `iat` on the session; `requireOwner()` already loads the owner, so reject (redirect to `/login`) when `iat * 1000 < owner.passwordChangedAt`. All older sessions die after a password change.
- Password reset by email is out of scope for one host: add `scripts/set-password.ts` (prompts for the email and the new password without echoing, applies the same rules, sets `passwordChangedAt`) and document it in the runbook.

### 4.4 Supply chain and secrets
- CI additions: `npm audit --omit=dev --audit-level=high`, `gitleaks` secret scan on every push, `prisma validate`, a check that `prisma migrate diff --from-migrations ... --to-schema-datamodel ... --exit-code` finds no drift, and `npm ci` everywhere. Add `.github/dependabot.yml` (weekly, npm and GitHub Actions, grouped minor and patch updates).
- Secrets live only in Railway variables and the operator's password manager. A `docs/SECURITY.md` lists every secret, where it is used, and how to rotate it.
- Set a PostgreSQL `statement_timeout` of 30 seconds for the application role.

## 5. Data protection

### 5.1 Roles and documents (`docs/`)
- `DATA_PROTECTION.md`: roles (host is controller of guest data; you are the processor; you are the controller of the host's own account data), a record of processing (what, why, whose, where), the retention schedule (below), how each data-subject right is handled with the in-app tools, the breach procedure (processor tells the controller without undue delay; the controller decides on notifying the supervisory authority within 72 hours; keep a breach log), and the subprocessor list.
- `DPA_TEMPLATE.md`: the data processing agreement between you and a host. It must cover the points GDPR Article 28(3) requires: subject matter, duration, nature and purpose, types of personal data, categories of data subjects, processing only on documented instructions, confidentiality of staff, security measures, conditions for subprocessors, assistance with data-subject requests, assistance with breaches and impact assessments, deletion or return of data at the end, and audits. **Marked clearly as a draft for legal review.**
- `GUEST_NOTICE.md`: a short text the host can send or display to guests (who is the controller, why the number is used, that an AI assistant answers messages, retention period, rights, contact) in English, with a note that it should be translated for guests' languages.
- `src/lib/processors.ts`: one typed list used by both `docs` generation and the public page: Railway (hosting and database), Twilio (message delivery), Meta WhatsApp (via Twilio), Anthropic (AI), Sentry (error reports), Resend (host notification email), the backup storage provider. For each: purpose, data involved, region. **Verify each vendor's current data processing terms and regions yourself before launch**, and use the EU region where one exists.
- **Public page `/privacy`** (no login): who runs the service, what is processed and why, the processor list rendered from `processors.ts`, retention periods, the statement that backups keep deleted data for up to 30 days, rights and how to exercise them, and a contact. Cookies: only an essential session cookie exists, so no consent banner is needed; do not add analytics without revisiting this.

### 5.2 Retention schedule (defaults, enforced by code)
| Data | Retention |
|---|---|
| Guest name, phone, language, notes, messages and scheduled messages | `owner.retentionDays` (default 90) after check-out, then deleted and the booking anonymised |
| Booking dates, source, apartment (no guest data left) | kept, for occupancy history |
| Messages from numbers with no booking | 30 days |
| Opt-out list (keyed hashes only) | kept |
| Login attempts (hashed) | 7 days |
| Job runs | 90 days |
| Audit log (no personal data) | 1 year |
| Database backups | 30 days (daily), 12 months (monthly), encrypted |
Enquiry leads (phases E1 to E3) will follow the same rule: 90 days after last contact unless converted to a booking.

### 5.3 Retention job: `src/lib/retention.ts`
```ts
import { prisma } from "./db";

const DAY = 86_400_000;

export async function runRetention(now = new Date(), dryRun = false) {
  const out = { bookings: 0, messages: 0, scheduled: 0, unmatched: 0, attempts: 0 };

  const owners = await prisma.owner.findMany({ select: { id: true, retentionDays: true } });
  for (const o of owners) {
    const cutoff = new Date(now.getTime() - Math.min(730, Math.max(30, o.retentionDays)) * DAY);
    for (;;) {
      const batch = await prisma.booking.findMany({
        where: {
          apartment: { ownerId: o.id }, isBlock: false, checkOut: { lt: cutoff }, anonymisedAt: null,
        },
        select: { id: true }, take: 500,
      });
      if (batch.length === 0) break;
      const ids = batch.map((b) => b.id);
      out.bookings += ids.length;
      if (dryRun) break; // count one batch only
      const [m, s] = await prisma.$transaction([
        prisma.message.deleteMany({ where: { bookingId: { in: ids } } }),
        prisma.scheduledMessage.deleteMany({ where: { bookingId: { in: ids } } }),
        prisma.booking.updateMany({
          where: { id: { in: ids } },
          data: { guestName: null, guestPhone: null, guestLanguage: null, notes: null, optedInAt: null, anonymisedAt: now },
        }),
      ]);
      out.messages += m.count; out.scheduled += s.count;
    }
  }
  if (!dryRun) {
    out.unmatched = (await prisma.unmatchedMessage.deleteMany({ where: { receivedAt: { lt: new Date(now.getTime() - 30 * DAY) } } })).count;
    out.attempts = (await prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 7 * DAY) } } })).count;
    await prisma.jobRun.deleteMany({ where: { startedAt: { lt: new Date(now.getTime() - 90 * DAY) } } });
    await prisma.auditLog.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 365 * DAY) } } });
    await prisma.auditLog.create({ data: { action: "RETENTION_RUN", targetType: "system", targetId: null } });
  }
  return out;
}
```
`POST /api/cron/retention` (cron secret, `withJobRun`, optional `?dryRun=1`). Anonymised bookings keep `optedOutAt` and are never matched to inbound messages (their phone is gone). Add a retention-days field (30 to 730) to the settings page with the explanation that it is the host's decision as controller.

### 5.4 Opt-out that survives deletion
`src/lib/hash.ts`: `hashPhone(e164) = HMAC-SHA256(DATA_PEPPER, e164)` hex.
- Phase 6 `optOutPhone(ownerId, e164)`: also `upsert` an `OptOut` row (`@@unique([ownerId, phoneHash])`).
- Phase 6 `phoneIsOptedOut`: true if any booking has `optedOutAt` **or** an `OptOut` row exists for the hash. Phase 5's create and update paths already call it, so a future booking with the same number is created opted out.
- Never log or return the hash.

### 5.5 Erasure and export: `src/lib/guest-data.ts` and actions
- `eraseGuestData(ownerId, bookingId, scope: "booking" | "phone")` (owner-scoped): for `phone`, collects every booking of this owner with the same number. In one transaction: delete their `Message` and `ScheduledMessage` rows, delete `UnmatchedMessage` rows with the same number (and `linkedBookingId` matches), anonymise the bookings exactly as retention does, and write `AuditLog(ERASE_GUEST)` with the booking id only. Idempotent.
- `collectGuestData(ownerId, bookingIds)`: returns plain JSON: for each booking its dates, apartment name, source and guest fields; all messages (direction, author, body, original body, language, timestamps, delivery status); scheduled messages (type, planned time, status); unmatched messages from the same number.
- `GET /api/export/guest?bookingId=...&scope=booking|phone`: requires a session, owner-scoped, returns the JSON with `Content-Disposition: attachment; filename="guest-data.json"` and `Cache-Control: no-store`, and writes `AuditLog(EXPORT_GUEST)`. It reads and writes nothing else.
- Booking detail page: a **Privacy** section with **Download this guest's data** and **Erase this guest's data** (a client confirmation that names the consequence: "This permanently deletes the name, phone number and all messages for this guest"; offers "Also for other bookings with the same number"). After erasure the page shows the anonymised booking.
- Account-level export and deletion (end of a contract): `scripts/export-owner.ts` and `scripts/delete-owner.ts` (the latter requires typing the owner's email twice and `--yes`); both write an `AuditLog` row. Document them in the runbook.

## 6. Cost controls

**`src/lib/usage.ts`**
```ts
import { prisma } from "./db";
import type { UsageKind } from "@prisma/client";

const monthStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const today = () => new Date(new Date().toISOString().slice(0, 10));
const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

export class BudgetExceededError extends Error {}

export async function recordUsage(ownerId: string, kind: UsageKind, tokens?: { input?: number; output?: number }) {
  await prisma.usageDaily.upsert({
    where: { ownerId_day_kind: { ownerId, day: today(), kind } },
    create: { ownerId, day: today(), kind, count: 1, inputTokens: tokens?.input ?? 0, outputTokens: tokens?.output ?? 0 },
    update: { count: { increment: 1 }, inputTokens: { increment: tokens?.input ?? 0 }, outputTokens: { increment: tokens?.output ?? 0 } },
  });
}

/** Estimated AI cost this month in euro cents, from tokens and the prices in the environment. */
export async function monthlyAiCostCents(ownerId: string, now = new Date()): Promise<number> {
  const rows = await prisma.usageDaily.findMany({
    where: { ownerId, day: { gte: monthStart(now) }, kind: { in: ["AI_REPLY", "AI_TRANSLATE", "AI_TEMPLATE"] } },
    select: { inputTokens: true, outputTokens: true },
  });
  const inTok = rows.reduce((n, r) => n + r.inputTokens, 0), outTok = rows.reduce((n, r) => n + r.outputTokens, 0);
  const pin = Number(process.env.AI_INPUT_EUR_PER_MTOK ?? 0), pout = Number(process.env.AI_OUTPUT_EUR_PER_MTOK ?? 0);
  return Math.ceil(((inTok * pin + outTok * pout) / 1_000_000) * 100);
}

export async function assertAiBudget(ownerId: string, now = new Date()): Promise<void> {
  const owner = await prisma.owner.findUniqueOrThrow({ where: { id: ownerId }, select: { monthlyAiBudgetCents: true } });
  if ((await monthlyAiCostCents(ownerId, now)) >= owner.monthlyAiBudgetCents) {
    throw new BudgetExceededError("Monthly AI budget reached.");
  }
}

export async function monthlyCount(ownerId: string, kind: UsageKind, now = new Date()): Promise<number> {
  const r = await prisma.usageDaily.aggregate({ where: { ownerId, kind, day: { gte: monthStart(now) } }, _sum: { count: true } });
  return r._sum.count ?? 0;
}
export { monthKey };
```

**Call sites to change (keep existing test mocks working by adding optional parameters):**
- `answerGuest` receives `ownerId`, calls `assertAiBudget` first, and records `AI_REPLY` with `res.usage.input_tokens` and `output_tokens`. `answerInbound` treats `BudgetExceededError` like the existing cap path: no AI call, escalate with "Monthly AI budget reached, no reply was sent."
- `translateText` (Phase 8) and `translateTemplate` (Phase 6) take an optional context `{ ownerId, kind }`; with it they assert the budget (throwing the existing friendly error type with "The monthly AI limit has been reached.") and record `AI_TRANSLATE` or `AI_TEMPLATE`. The **Test assistant** action records `AI_REPLY`.
- `sendWhatsApp` takes optional `{ ownerId, kind }` and records `WA_TEMPLATE` (scheduled templates) or `WA_FREEFORM` (replies) after a successful send, in all modes.
- Phase 6 `sendOne`: before sending a template, if `monthlyCount(owner, "WA_TEMPLATE") >= owner.monthlyTemplateCap`, set the row back to `PENDING` without consuming an attempt (it will be skipped as too late if the cap is not lifted) and show it in the attention panel and self-check.
- **80% warning:** when AI cost or template count first crosses 80% in a month and `budgetWarnedMonth` differs from the current month, email the host and the operator once and set `budgetWarnedMonth`.

**`/settings/usage`** (owner-scoped): this month and the previous two: AI replies, translations, template messages, free-form messages, tokens, **estimated AI cost in euros**, template messages multiplied by `waTemplateCost` for an estimated WhatsApp cost, the caps and what remains, and editable fields for the AI budget (euros), template cap and cost per template message (with a note to copy the current price for Malta and the guest countries from Twilio's price list). Validation: budget 0 to 500 euros, cap 0 to 20000.

**Provider-side limits (document in the runbook, set them before launch):** a monthly spend limit on the Anthropic account or workspace, and a low usage-trigger or auto-recharge ceiling on Twilio, so a bug cannot cost more than you accept.

**Kill switches: `src/lib/flags.ts`**
```ts
export const assistantEnabled = () => process.env.ASSISTANT_ENABLED !== "false";
export const automaticMessagesEnabled = () => process.env.AUTOMATIC_MESSAGES_ENABLED !== "false";
```
`answerInbound`: when the assistant is disabled, skip the AI, send the holding message in the guest's language and escalate ("Assistant switched off"). `sendDueMessages`: when automatic messages are disabled, return immediately and leave rows `PENDING` (they are skipped later as too late if the switch stays off). The status page shows both flags.

## 7. Backups and restore (`ops/backup/`)

- `Dockerfile` (`postgres:16-alpine` plus `age` and the AWS CLI, or `rclone`) and `backup.sh`:
```bash
#!/bin/sh
set -eu
ts=$(date -u +%Y%m%dT%H%M%SZ)
key="daily/ostra-$ts.dump.age"
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" \
  | age -r "$AGE_PUBLIC_KEY" \
  | aws s3 cp - "s3://$BACKUP_BUCKET/$key" --endpoint-url "$S3_ENDPOINT"
# first day of the month: keep a copy as the monthly backup
if [ "$(date -u +%d)" = "01" ]; then
  aws s3 cp "s3://$BACKUP_BUCKET/$key" "s3://$BACKUP_BUCKET/monthly/ostra-$ts.dump.age" --endpoint-url "$S3_ENDPOINT"
fi
curl -fsS "$BACKUP_PING_URL" >/dev/null || true
```
- Railway service `cron-backup`, schedule `0 1 * * *`, environment `DATABASE_URL` (private URL), `AGE_PUBLIC_KEY`, `BACKUP_BUCKET`, `S3_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `BACKUP_PING_URL`.
- Storage: an S3-compatible bucket (Cloudflare R2 or Backblaze B2) **in the EU where available**, private, with a lifecycle rule deleting `daily/` after 30 days and `monthly/` after 12 months, and credentials limited to that bucket. The **age private key stays offline** (password manager plus a printed copy), never on Railway or in the repo.
- `ops/backup/restore-check.sh`: downloads the newest dump, decrypts it locally with the private key, restores it into `RESTORE_DATABASE_URL` (a scratch database, never production) with `pg_restore --clean --if-exists --no-owner`, then runs sanity SQL (counts of owners, apartments, bookings, messages; latest booking date) and prints them.
- `ops/backup/RESTORE.md` (also summarised in the runbook): restoring production means (1) put the app in maintenance (`ASSISTANT_ENABLED=false`, `AUTOMATIC_MESSAGES_ENABLED=false`, scale the web service to zero), (2) restore, (3) **run the retention job before reopening so deleted data does not return**, and re-apply the opt-out list from the restored data, (4) run migrations, (5) reopen and watch the status page. State the recovery targets honestly: at most one day of data lost, restore time measured in the rehearsal.
- **Rehearse once before launch and then every quarter**, and record the result (date, backup used, time taken, checks) in `docs/RESTORE_LOG.md`.

## 8. End-to-end tests (Playwright)

- `npm i -D @playwright/test @axe-core/playwright`. CI job `e2e`: Postgres service, `prisma migrate deploy`, seed, `next build && next start`, Chromium, upload traces on failure.
- **Test seam for the AI:** `src/lib/llm-client.ts` exports `getAnthropic()`; when `LLM_FAKE=1` it returns a deterministic fake (the `respond` tool answers "FAKE REPLY" and escalates when the message contains "refund"). The function **throws if `LLM_FAKE` is set while `NODE_ENV=production`**. All AI code uses `getAnthropic()`. `WHATSAPP_MODE=dry-run` in E2E.
- Specs:
  1. Every route under `(app)` (generated from the file system) redirects to `/login` when logged out; `/privacy` and `/api/health` are public; cron and webhook routes return 401 or 403 without credentials.
  2. Login: generic error for a wrong password; lockout after 5 failures (even with the right password afterwards); success and logout.
  3. Calendar shows seeded bookings, a flagged double booking and the attention panel at 390 px width with no horizontal page scroll.
  4. Create a direct booking, accept the overlap warning, see it on the calendar; edit an apartment's information and see it saved.
  5. Inbox: seeded escalation visible; reply in the same language; message appears as "You" and the item is resolved.
  6. Password change: old password fails afterwards and an old session is rejected.
  7. Erase a guest's data: the messages and name disappear, the booking remains with dates, and the opt-out list still blocks the number.
  8. Security headers present on a page (`Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`).
  9. Axe accessibility scan on login, calendar, inbox and settings: no `serious` or `critical` violations.

## 9. Runbook: `docs/RUNBOOK.md`
Sections (concise, step by step, with the exact commands): architecture diagram (web, Postgres, five-plus cron services, Twilio, AI, Sentry, backups); environments and every variable; deploy and **rollback** (redeploy the previous Railway deployment; migrations follow expand-then-contract so the previous code still works; never run `migrate reset` in production); secret rotation per secret; kill switches and what each does; incident playbooks (WhatsApp sender restricted or quality rating drops: switch to dry-run and tell the host; Twilio outage; AI outage, where the assistant falls back to holding replies and escalations; database down; calendar sync failing; suspected duplicate messages; runaway cost: lower the AI budget, flip the kill switches, check provider limits; suspected data breach: contain, record, notify the controller without undue delay, support their 72-hour decision); restore from backup (section 7); onboarding a new host; offboarding (export, then delete); monthly checklist (usage and cost review, failed and skipped messages, dependency updates, check heartbeat monitors) and quarterly checklist (restore rehearsal, secret review, DPA and processor list review).

## 10. Tests (unit and database)
**Unit**
- `scrub`: removes `+356 7912 3456`, `00356 79123456`, emails, calendar URLs with tokens, long digit runs; leaves short numbers like `15:00` and `120`.
- `log`: drops unknown fields (`body`, `phone`, `guestName`, `icalUrl` never appear in output), keeps allowed ones, scrubs string values.
- Sentry `beforeSend`: removes request data, cookies, headers, user, and scrubs exception text and breadcrumbs.
- `clientIp`: ignores `x-forwarded-for` unless `TRUST_PROXY=1`; takes the first hop.
- Password rules: length, common list, equals email, accepts a good passphrase.
- `hashPhone`: deterministic, differs per pepper, different numbers differ, output is not the input.
- Pricing: `monthlyAiCostCents` from tokens and the environment prices; zero prices give 0; `assertAiBudget` throws exactly at the cap.
- `flags`: default on; only the literal `"false"` turns them off.
- `llm-client`: throws when `LLM_FAKE=1` and `NODE_ENV=production`.
- Security headers configuration contains every required header and a CSP with `frame-ancestors 'none'` and no wildcard sources.

**Database**
1. Login guard: five failures lock the email for 15 minutes; 20 from one IP lock the IP; locked-out correct passwords fail; successes are not counted; attempts store only hashes; old attempts are not counted.
2. Password change updates the hash and `passwordChangedAt`, writes an audit row without secrets, rejects a wrong current password, and a session issued before the change is rejected by `requireOwner`.
3. Retention: bookings past each owner's own cutoff are anonymised (name, phone, language, notes, opt-in cleared, `anonymisedAt` set) and their messages and scheduled messages deleted; bookings inside the cutoff, blocks and other owners' data untouched; `retentionDays` clamped to 30-730; batches over 500; idempotent on a second run; dry run changes nothing; unmatched messages over 30 days, login attempts over 7 days and job runs over 90 days deleted; opt-out hashes kept.
4. Opt-out survival: after `optOutPhone`, run retention (phone gone); a new booking with that number is created opted out and cannot be opted in; another owner's identical number is unaffected.
5. `eraseGuestData`: scope `booking` and scope `phone`; deletes messages, scheduled messages and unmatched rows for the number; anonymises; audit row has no personal data; another owner's booking returns `notFound`; idempotent.
6. Export: owner-scoped, contains the expected fields, `no-store` header, audit row, unauthenticated returns a redirect or 401, another owner's booking is `notFound`, and no write other than the audit row.
7. `withJobRun` records success and failure and never stores personal data in `summary`; all cron routes return 401 without the secret and record a run with it.
8. `self-check`: each alert condition (stale job, overdue pending, failed messages, urgent escalation unanswered, feed errors, 80% usage) is detected; the operator email is sent on the transition to degraded and **not repeated** while it stays degraded; the heartbeat ping is called.
9. `inbound-recovery`: an unanswered guest message older than 3 minutes is escalated once; answered messages, flood bookings, messages younger than 3 minutes, already escalated messages and other states are left alone; it never calls the AI.
10. Usage: recording increments the daily row by kind; budget exceeded makes `answerInbound` escalate without calling the AI, makes translations return the friendly error, and the template cap leaves rows `PENDING`; the 80% email is sent once per month; the usage page numbers match the rows; all of it owner-scoped.
11. Kill switches: with `ASSISTANT_ENABLED=false` inbound gets the holding reply and an escalation and no AI call; with `AUTOMATIC_MESSAGES_ENABLED=false` nothing is sent and rows stay `PENDING`.
12. No `GET` route changes data (assert row counts before and after requesting every `GET` route as an authenticated owner, except the export route's audit row).
13. ESLint passes with `no-console` and the repository contains no `console.` outside `log.ts` and `scripts/`.

## 11. Manual checks
1. `curl -I https://<app>/` shows all security headers; the login lockout works from a phone; the privacy page loads logged out.
2. Break something on purpose in staging (throw in a cron route): the error appears in Sentry with no personal data, `JobRun` shows the failure, and the self-check emails you once.
3. Stop a cron service for longer than its grace period: the heartbeat monitor alerts.
4. Run the retention job with `?dryRun=1` on a copy of real-looking data, then for real; erase and export one test guest.
5. **Restore rehearsal:** restore last night's dump into a scratch database with `restore-check.sh`, record the result in `docs/RESTORE_LOG.md`.
6. Lower the AI budget to 1 euro in staging and watch the assistant escalate instead of answering; switch `ASSISTANT_ENABLED=false` and confirm the holding reply.
7. Check the Anthropic and Twilio spend limits are set in their consoles.

## 12. Acceptance criteria
- No phone number, message text, guest name, email or calendar URL appears in logs, Sentry events or notification emails (tests and a manual Sentry check).
- Every background job records its runs, has a heartbeat, and a stale, failing or overdue job produces one operator alert; unanswered guest messages after a restart are escalated.
- Security headers, CSRF origin checks, login lockout, generic login errors, password change with session invalidation, dependency and secret scanning are in place and tested.
- Retention, erasure, export and the opt-out list work, are owner-scoped and audited without personal data; deleted guest data cannot reappear through a restore procedure that is documented.
- `/privacy`, `docs/DATA_PROTECTION.md`, `docs/DPA_TEMPLATE.md` (marked for legal review), `docs/GUEST_NOTICE.md` and the processor list exist and agree with each other.
- Usage and estimated cost are visible; AI budget, template cap and provider-side limits stop runaway spend; kill switches work.
- Nightly encrypted backups run to separate EU storage with a heartbeat, and a restore was rehearsed and logged.
- Playwright smoke and accessibility tests run in CI; `npm run lint`, `typecheck`, `test`, `build`, audit and secret scan pass; migrations apply on a fresh database and show no drift.
- `docs/RUNBOOK.md` exists with the sections above.

## 13. Not in this phase
- Two-factor login, password reset by email, multi-user accounts, a nonce-based CSP, a self-service account deletion screen, a formal security audit or penetration test, and automatic regional failover.

## 14. Suggested split (if one PR is too large)
- **9A, observability and security:** sections 2, 3, 4, kill switches, status page, and the related tests and E2E specs 1, 2, 8, 9.
- **9B, data protection and cost:** sections 5 and 6, `/privacy` and the `docs/` files, E2E specs 6 and 7.
- **9C, backups, runbook and rehearsal:** sections 7 and 9, the restore rehearsal, the remaining E2E specs.
