# Ostra: rules for AI engineers

Product: guest messaging and booking overview for holiday-rental hosts in Malta. Node 22, Next.js App Router, TypeScript strict, Prisma and PostgreSQL, Auth.js, Twilio WhatsApp, Anthropic API, Railway.

## Commands
npm run dev | lint | typecheck | test | build | db:migrate | db:deploy | db:seed
Tests run with TZ=UTC. Database tests need DATABASE_URL pointing at a throwaway database.

## Non-negotiable rules
1. Every query that touches owner data is scoped by ownerId (through the apartment). Every server action and page starts with requireOwner(). Add an owner-scoping test for anything new.
2. Never log or report phone numbers, guest names, message text, calendar URLs or tokens. Use src/lib/log.ts (allow-list) and reportError(). No console.* in src (ESLint enforces it).
3. Dates are Malta calendar dates (YYYY-MM-DD strings); stays occupy nights [checkIn, checkOut). Use src/lib/dates.ts and src/lib/time.ts. Never do day arithmetic on Date objects.
4. The AI never decides availability, prices, money, access or exceptions. Code does, or the host does. AI output is checked by code before it is sent.
5. Private apartment information (codes, Wi-Fi password, address) goes into a prompt only inside the unlock window, and never into enquiry prompts.
6. WhatsApp: free-form messages only inside the 24-hour window; business-initiated messages only through approved templates and only to guests who opted in. WHATSAPP_MODE defaults to dry-run.
7. Anything sent to a guest must be idempotent (unique SIDs, atomic claims) and at-most-once.
8. Migrations: one per phase, named as in the phase document, never edited after merge, expand-then-contract.
9. Keep PRs to one phase. Do not add dependencies that are not named in the phase document without saying why in the PR.
10. UI is mobile first (390 px), no horizontal page scroll, text rendered with dir="auto" for guest content, colour never the only signal.
11. When a document and reality disagree, stop and report; do not guess silently.

## Repository layout (target)
src/app/(app)/            calendar, apartments, bookings, inbox, leads, assistant/test, reviews/draft, settings/*
src/app/api/              auth, health, cron/*, webhooks/{twilio,twilio-status}, ical/[token], export/guest
src/app/login, privacy
src/lib/                  db, auth, log, scrub, report-error, dates, time, languages, phone, validation,
                          calendar-*, conflicts, ical, ical-fetch, ical-export, sync, schedule, send-time,
                          templates, message-render, whatsapp, send-scheduled, assistant*, inbound*, notify,
                          optout, hash, retention, guest-data, usage, flags, availability*, enquiry*,
                          lead-follow-up*, review-draft, weekly-summary, job-run, login-guard, rate-limit
src/components/           forms, Timeline, panels, Composer, ExportPanel, ...
prisma/                   schema.prisma, migrations/, seed.ts
scripts/                  run-cron.mjs, simulate-inbound.mjs, set-password.ts, export-owner.ts, delete-owner.ts
ops/backup/               Dockerfile, backup.sh, restore-check.sh, RESTORE.md
docs/                     RUNBOOK, DATA_PROTECTION, DPA_TEMPLATE, GUEST_NOTICE, SECURITY, RESTORE_LOG, EXPORT_TEST
tests/                    unit, db, e2e, llm-eval (opt-in)
.github/workflows/        ci.yml, e2e (Phase 9), dependabot.yml

## Environment variables (all phases)
Variable                  Needed from  Notes
DATABASE_URL, AUTH_SECRET, AUTH_TRUST_HOST, APP_URL, TZ=UTC, CRON_SECRET, NODE_ENV  Phase 1  APP_URL is the public https URL without a trailing slash
SEED_OWNER_EMAIL, SEED_OWNER_PASSWORD, SEED_ALLOW_PRODUCTION  Phase 1  Remove after the first production seed
WHATSAPP_MODE (dry-run, sandbox, production), TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM  Phase 6  Default dry-run
ANTHROPIC_API_KEY, ANTHROPIC_MODEL  Phase 6  Model string set in one place
MAX_TEMPLATE_SENDS_PER_DAY, MAX_AI_REPLIES_PER_DAY, INBOUND_DEBOUNCE_MS  Phases 6-7  Safety caps
RESEND_API_KEY, NOTIFY_FROM, OPERATOR_EMAIL  Phases 7, 9  Sending domain needs SPF and DKIM records
DATA_PEPPER, TRUST_PROXY=1, SENTRY_DSN, SENTRY_AUTH_TOKEN  Phase 9  Pepper: long random, never rotated casually
AI_INPUT_EUR_PER_MTOK, AI_OUTPUT_EUR_PER_MTOK  Phase 9  Copy from the AI provider's current price list
ASSISTANT_ENABLED, AUTOMATIC_MESSAGES_ENABLED  Phase 9  Kill switches, default on
PING_URL_<JOB>, BACKUP_PING_URL  Phase 9  Heartbeat monitor URLs
AGE_PUBLIC_KEY, BACKUP_BUCKET, S3_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY  Phase 9  Backup service only
EXPORT_STALE_AFTER_HOURS  Phase 11  Default 48
LEAD_FOLLOW_UP_AFTER_HOURS  Phase 12  Default 16
LLM_FAKE, RUN_LLM_EVALS  tests only  LLM_FAKE must refuse to run in production

## Railway services
Service                  Schedule (UTC)  Command  Phase
web                      always on, one replica  npx prisma migrate deploy && npm run start  1
postgres                 managed  1
cron-sync-calendars      */30 * * * *  node scripts/run-cron.mjs sync-calendars  3
cron-send-scheduled      */10 * * * *  ... send-scheduled  6
cron-sync-templates      0 * * * *  ... sync-templates  6
cron-escalation-reminders  */15 * * * *  ... escalation-reminders  8
cron-retention           30 1 * * *  ... retention  9
cron-self-check          */15 * * * *  ... self-check  9
cron-inbound-recovery    */5 * * * *  ... inbound-recovery  9
cron-backup              0 1 * * *  Docker image from ops/backup  9
cron-lead-follow-ups     */15 * * * *  ... lead-follow-ups  12
cron-weekly-summary     0 6 * * 1  ... weekly-summary  13

Every cron service needs APP_URL, CRON_SECRET, TZ=UTC and its PING_URL_<JOB>. Check Railway's current limits on cron frequency and on the number of services for your plan.

## What is not code (you must do these yourself)
- Accounts and setup: Railway, Twilio, Meta Business verification and a WhatsApp sender with a dedicated number, approved templates, Anthropic API account with a spend limit, Sentry (EU region), Resend with a verified sending domain, a heartbeat and uptime monitor, an S3-compatible bucket in the EU for backups, and a domain name for the app.
- Legal and business: lawyer review of docs/DPA_TEMPLATE.md, the privacy page, the guest notice and the pilot agreement; trade registration, tax and insurance questions with an accountant; each vendor's data processing terms and regions.
- Operations: restore rehearsal, the loop test for calendar export, the 20-question assistant test with your friend, and the Phase 10 go/no-go gate.

## Things I could not verify (check them against current documentation before relying on them)
- Exact Twilio Content API calls for creating and approving WhatsApp templates, and which template languages WhatsApp supports (some of the 42 may not be on the list; the fallback language covers them).
- Whether your Booking.com account offers calendar import, how often Airbnb and Booking.com re-read imported calendars, and whether either re-exports imported calendars (the loop test answers the last question empirically).
- Railway's configuration-as-code fields, minimum cron interval, backup features, and EU region availability; Twilio, Meta and AI provider prices.
- WhatsApp's classification of review requests and follow-up style messages as marketing.
- Behaviour of new library versions (Auth.js v5 beta, after() in Next.js 15, the Anthropic SDK types). The code in the documents is specification-grade and untested; expect Devin to adjust syntax and types, and have it report each deviation in the PR.

## Definition of "project complete"
- Documents 1 to 9 merged and deployed; Phase 9 restore rehearsal logged; Phase 10 go/no-go gate fully ticked; pilot run with stages 0 to 3 passed and day 7 and day 30 reviews held.
- Documents 11 to 14 built in the order the pilot's evidence supports, each passing its acceptance criteria and, where required, its loop test or language evaluation.
- No open item in section 7, a current docs/RUNBOOK.md, and a working monthly and quarterly maintenance routine.
