# Ostra: Build Plan (scratch to production)

Guest-communication and booking-calendar tool for hosts managing several apartments (Malta). First user: one host with 3 apartments, booked via Airbnb, Booking.com and direct.

> **How to use this file with Devin:** put it in the repo root. Give Devin one phase at a time: *"Read OSTRA_PLAN.md. Complete Phase N only. Meet every acceptance criterion, run the checks, open a PR."* Review and merge before starting the next phase.

---

## 0. Ground rules (apply to every phase)

- **Stack:** Next.js 15 (App Router) + TypeScript (strict), Tailwind, Prisma + PostgreSQL, Auth.js (credentials), Zod validation, Vitest, Playwright (smoke), Twilio (WhatsApp), Anthropic SDK, Vercel hosting + Vercel Cron.
- **One PR per phase.** Small commits. Do not add libraries not listed here without saying why in the PR.
- **Every phase must end green:** `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`.
- **Security defaults:** all `/app/**` and `/api/**` routes (except webhooks and crons) require a session. Every query is scoped by `ownerId`. Webhooks verify signatures. Crons verify `CRON_SECRET`. No secrets in the repo.
- **Dates:** store UTC, display in `Europe/Malta`. Apartment check-in/out is a date plus the apartment's local time.
- **Errors:** never swallow. Log with context. Surface sync errors to the user in the UI.

### Environment variables (`.env.example`)
```
DATABASE_URL=
AUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-5-5
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
CRON_SECRET=
APP_URL=http://localhost:3000
```

### Target folder structure
```
src/
  app/
    (auth)/login/page.tsx
    (app)/layout.tsx              # session-guarded shell + nav
    (app)/calendar/page.tsx
    (app)/apartments/page.tsx
    (app)/apartments/[id]/page.tsx
    (app)/bookings/new/page.tsx
    (app)/inbox/page.tsx
    api/auth/[...nextauth]/route.ts
    api/cron/sync-calendars/route.ts
    api/cron/send-scheduled/route.ts
    api/webhooks/twilio/route.ts
  lib/
    db.ts            # Prisma singleton
    auth.ts          # Auth.js config + requireOwner()
    ical.ts          # fetch + parse + normalise
    sync.ts          # upsert bookings per feed
    conflicts.ts     # turnover + double-booking detection
    ai.ts            # answerGuest()
    whatsapp.ts      # sendWhatsApp(), validateSignature()
    schedule.ts      # create ScheduledMessage rows for a booking
    templates.ts     # message templates + variable fill
  components/
prisma/schema.prisma, prisma/seed.ts
tests/
```

---

## Phase 1: Foundation, auth, deploy
**Goal:** empty app, secure login, deployed to a public URL.

Tasks
1. `create-next-app` with TS, Tailwind, App Router, ESLint. Add Prettier, `typecheck` script, Vitest.
2. Add `prisma/schema.prisma` (provided). Add `passwordHash String` to `Owner`. Run the first migration.
3. `lib/db.ts` Prisma singleton.
4. Auth.js credentials provider (email + password, `bcryptjs`). `requireOwner()` helper that returns the owner or redirects to `/login`.
5. `prisma/seed.ts`: create one owner (email and password from env), 3 apartments, and a few sample bookings.
6. Login page, protected `(app)` layout with nav: Calendar, Apartments, Inbox.
7. GitHub Actions CI: install, lint, typecheck, test, build.
8. Deploy to Vercel with a hosted Postgres (Neon). Run `prisma migrate deploy` in the build step.

Acceptance
- Visiting `/calendar` logged out redirects to `/login`.
- Seeded owner can log in and log out.
- CI passes; production URL loads.

---

## Phase 2: Apartments and knowledge base
**Goal:** the host can manage apartments and the info the AI will answer from.

Tasks
1. `/apartments`: list with "Add apartment".
2. `/apartments/[id]`: edit form (name, address, check-in time, check-out time, `info` textarea). Zod-validated server actions. Provide an `info` starter template (sections: Check-in steps, Key/lockbox, Wi-Fi, Parking, House rules, Local tips, Emergency contact).
3. Calendar feeds section on the apartment page: add/remove feed (`source` = AIRBNB or BOOKING_COM, `icalUrl`). Validate that the URL is `https` and ends like an iCal feed or returns `text/calendar`.
4. Ownership checks on every action (an owner cannot touch another owner's apartment). Add a test for this.

Acceptance
- Create, edit and delete work. Cross-owner access returns 404 (tested).
- Info text persists and shows the starter template for new apartments.

---

## Phase 3: iCal sync
**Goal:** bookings from Airbnb and Booking.com appear automatically.

Tasks
1. `lib/ical.ts`: fetch the feed (10 s timeout, 2 MB max), parse with `node-ical`, return `{ uid, start, end, summary }[]`. Skip entries that are blocks/unavailable (summary such as "Not available", "Blocked", "CLOSED"). Treat all-day dates as the apartment's local check-in/check-out time.
2. `lib/sync.ts` `syncFeed(feed)`:
   - Upsert each event as a `Booking` by `(apartmentId, externalUid)` with the feed's `source`.
   - Bookings from this feed that no longer appear in the feed (and are in the future) get `status = CANCELLED`.
   - Never modify or cancel `DIRECT` bookings.
   - Set `lastSyncAt`; on failure set `lastError` and keep existing bookings.
3. `/api/cron/sync-calendars`: requires header `Authorization: Bearer ${CRON_SECRET}`; syncs all feeds. Add `vercel.json` cron every 30 minutes. (Vercel Hobby limits cron frequency; use hourly, or GitHub Actions on a schedule calling the endpoint.)
4. "Sync now" button per feed and "last synced / error" display.
5. Unit tests with fixture `.ics` files: new booking, changed dates, cancellation, blocked dates, malformed feed.

Acceptance
- Re-running sync twice creates no duplicates.
- A removed future event becomes CANCELLED; a failing feed keeps old data and shows the error.
- Cron endpoint returns 401 without the secret.

Note: Airbnb and Booking.com iCal feeds usually contain **dates only**, with no guest name or phone. The host adds contact details manually (Phase 5).

---

## Phase 4: Calendar view and conflict detection
**Goal:** one view across all apartments that shows what needs attention.

Tasks
1. `lib/conflicts.ts`:
   - **Double booking:** two non-cancelled bookings in the same apartment with overlapping nights.
   - **Same-day turnover:** a check-out and a check-in on the same date in the same apartment.
2. `/calendar`: month/timeline view, one row per apartment, bookings coloured by source (Airbnb, Booking.com, Direct), cancelled hidden. Double bookings in red, turnovers with a badge. Mobile-friendly (horizontal scroll).
3. "Today" panel: arrivals, departures and turnovers today and tomorrow.
4. Tests for conflict logic (back-to-back stays are not overlaps; same-day turnover is flagged; cancelled ignored).

Acceptance
- Seed data shows at least one turnover and one forced double booking correctly flagged.
- Usable on a phone width (390 px).

---

## Phase 5: Direct bookings and guest contact
**Goal:** the host can add direct bookings and attach guest phone numbers.

Tasks
1. `/bookings/new`: apartment, check-in, check-out, guest name, phone. Reject overlaps with an error message and an explicit "create anyway" option.
2. Edit booking (guest name, phone) from the calendar. Normalise phones to E.164 (`libphonenumber-js`, default country MT).
3. Booking detail page: dates, source, guest, message history, scheduled messages.
4. Direct bookings can be edited or cancelled; synced bookings only allow guest name and phone edits.

Acceptance
- Phone numbers are stored in E.164. Overlap warning works. Synced booking dates cannot be edited.

---

## Phase 6: Scheduled messages
**Goal:** automatic pre-arrival, check-in, check-out and review messages.

Tasks
1. `lib/templates.ts`: four templates with variables `{{guestName}} {{apartmentName}} {{checkInTime}} {{checkOutTime}} {{address}}`. The host can edit them per owner (add `MessageTemplate` model or an owner-level JSON field).
2. `lib/schedule.ts`: when a booking has a phone number and is confirmed, upsert `ScheduledMessage` rows:
   - PRE_ARRIVAL: 3 days before check-in, 10:00 Malta time
   - CHECK_IN: check-in day, 09:00
   - CHECK_OUT: day before check-out, 18:00
   - REVIEW_REQUEST: day after check-out, 11:00
   Re-run when dates or phone change. Delete unsent rows for cancelled bookings.
3. `/api/cron/send-scheduled` (CRON_SECRET-protected, every 10 minutes): select rows with `sendAt <= now` and `sentAt IS NULL`, send, set `sentAt`. Use a transaction or `updateMany` claim to prevent double sends.
4. `lib/whatsapp.ts`: `sendWhatsApp(to, body)` via Twilio. Store each send as an OUTBOUND `Message`.
5. Per-booking toggle "pause automatic messages".

Acceptance
- Changing a booking's dates moves its scheduled times. Running the cron twice sends once. Cancelled bookings send nothing. Tests use a mocked Twilio client.

> **WhatsApp reality check:** messages sent outside a 24-hour guest-initiated window must use **pre-approved WhatsApp templates**, and production sending needs a verified Meta business and an approved sender via Twilio. Start on the Twilio WhatsApp **sandbox** for development, and begin the business verification and template approval during Phase 6 because it can take days. Keep content practical (stay information) and keep guests on their booking platform's rules.

---

## Phase 7: Inbound messages and the AI assistant
**Goal:** guests ask questions on WhatsApp and get answers from the apartment's info.

Tasks
1. `/api/webhooks/twilio`: validate `X-Twilio-Signature` (Twilio `validateRequest` with `APP_URL`). Parse `From` and `Body`.
2. Match the booking: normalise `From`, find a non-cancelled booking with that `guestPhone` where today is between (check-in minus 3 days) and (check-out plus 1 day). If none, store nothing sensitive and reply with a short "we can't find your booking" message and notify the host.
3. `lib/ai.ts` `answerGuest({ apartment, booking, history, question })`:
   - Call Anthropic with a system prompt: *answer only from the property information below; be brief and friendly; if the answer is not in the information, or the guest reports a problem, an emergency, a complaint, a refund or payment issue, reply exactly `ESCALATE`.*
   - Include the last 10 messages for context. Temperature low. Max tokens about 300.
   - Return `{ reply, escalate }`.
4. If `escalate`: send the guest "Thanks, I'll check with your host and come back to you shortly." and mark the inbound `Message` with `escalated = true`. Otherwise send the reply.
5. Store INBOUND and OUTBOUND messages. Rate-limit per phone number (e.g., 20 messages/hour) to control cost.
6. Never include other guests' data or other apartments' info in the prompt.
7. Tests: mocked AI for the answer path, escalation path, unknown number, bad signature (403).

Acceptance
- With the sandbox, a test phone asking "What's the Wi-Fi?" gets the Wi-Fi from the apartment info. Asking something not in the info triggers escalation. Invalid signatures are rejected.

---

## Phase 8: Host inbox
**Goal:** the host handles escalations.

Tasks
1. `/inbox`: unresolved escalated messages grouped by booking, with conversation history, apartment and dates.
2. Reply box that sends via WhatsApp and stores an OUTBOUND message. "Mark resolved" action. Nav badge with unresolved count.
3. Optional: "add to apartment info" shortcut that appends the question and the host's answer to the apartment's `info`, so the AI answers it next time.
4. Host notification when something escalates (email through Resend, or a WhatsApp message to the host's number).

Acceptance
- An escalated guest message appears in the inbox. The host reply reaches the guest. Resolved items disappear.

---

## Phase 9: Production hardening
Tasks
1. **Monitoring:** Sentry for errors, a `/api/health` endpoint, uptime check.
2. **Logging:** structured logs for syncs, sends and AI calls (no message bodies in logs).
3. **Security:** security headers, CSRF-safe server actions, login rate limiting, password change page, secrets only in Vercel env.
4. **Data protection (GDPR):** privacy page; data retention job that deletes guest name, phone and messages 90 days after check-out (or on request); data export/deletion for a booking; DPA note in the host terms. Record in the privacy page which processors are used (Twilio, Anthropic, Vercel, database host).
5. **Backups:** enable automated database backups with the provider and document a restore test.
6. **Cost controls:** monthly AI and WhatsApp usage counter on the settings page; hard cap per owner.
7. **E2E smoke test (Playwright):** login, view calendar, add direct booking, edit apartment.
8. **Runbook** `docs/RUNBOOK.md`: deploy, rollback, rotate secrets, what to do if sync or WhatsApp fails.

Acceptance
- Errors reach Sentry. Retention job tested. Backup restore verified once. Smoke test in CI.

---

## Phase 10: Launch and iterate
1. Onboard the host: add her 3 apartments, paste her 6 iCal links, fill in `info`, add phone numbers for the next 2 weeks of bookings.
2. Run **sandbox with her real next arrival** before switching to the production WhatsApp sender.
3. Week 1 review: which escalations happened? Add them to `info`. Which messages did she edit? Adjust templates.
4. Only then consider: cleaner coordination, multi-language replies, multiple owners and billing.

---

## Definition of done for v1
- Host logs in, sees all 3 apartments' bookings from all 3 channels, with conflicts flagged.
- Guests receive timed messages and get answers to basic questions on WhatsApp.
- Anything uncertain reaches the host's inbox.
- Deployed, monitored, backed up, with a privacy page and retention job.
