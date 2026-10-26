# Ostra hosting addendum: Vercel + Neon (replaces Railway)

> **For Devin:** this document **overrides every Railway statement** in `OSTRA_MASTER_GUIDE.md`, `OSTRA_PHASE1_FOUNDATION_RAILWAY.md`, `OSTRA_PHASE3_ICAL_SYNC.md`, `OSTRA_PHASE6_MESSAGES.md`, `OSTRA_PHASE8_INBOX.md`, `OSTRA_PHASE9_HARDENING.md`, `OSTRA_PHASE11_CALENDAR_EXPORT.md`, `OSTRA_PHASE12_FOLLOW_UPS.md` and `OSTRA_PHASE13_REVIEWS_SUMMARY.md`. Apply it **during Phase 1** so later phases never need rework. If Phase 1 was already built for Railway, do the changes below as one PR named "hosting: Vercel and Neon" before Phase 2. Everything not mentioned here stays as written.

## 1. Why this is more than a deployment target change
Railway ran a long-lived server, cron services and a Postgres next to each other. Vercel runs **short-lived serverless functions** and Neon is a **pooled, auto-suspending serverless Postgres**. Seven things change: cron, background work after a response, database connections, rate limiting, kill switches, backups, and Preview deployments. Each is handled below.

## 2. Plans and costs (decide before building)
- **Vercel Pro is required for this product.** Per Vercel's cron documentation, Hobby cron jobs can run only once per day (with timing precision of about an hour), while Pro allows once per minute. Ostra needs jobs every 5 to 30 minutes (calendar sync, scheduled messages, escalation reminders, recovery, self-check). Also check Vercel's terms: as far as I know the Hobby plan is meant for personal, non-commercial use, and Ostra is a paid service. Pro is billed per seat, so budget for it in your pricing.
- **Neon: use a paid plan for production.** The free plan has monthly compute-hour and storage limits and suspends compute when they run out, and frequent cron calls keep waking the database. Check Neon's current plan limits and the autosuspend setting before choosing; a sleeping database adds a delay to the first request after idle time.
- Use **Neon branches** for development, Preview deployments and CI test databases (never the production branch).
- Choose **EU regions**: a Neon project in an EU region and Vercel functions pinned to a nearby EU region (`"regions": ["fra1"]` in `vercel.json`), for latency and for the GDPR documents.

## 3. Database on Neon
- `prisma/schema.prisma` datasource:
```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")   // Neon POOLED connection string (host contains "-pooler")
  directUrl = env("DIRECT_URL")     // Neon DIRECT connection string, used by migrations only
}
```
- `DATABASE_URL` carries `?pgbouncer=true&connect_timeout=15` (and a small `connection_limit`, for example 5) because the pooler works in transaction mode. `DIRECT_URL` has no pooler.
- Transaction-scoped features used in the code are fine with the pooler: `pg_try_advisory_xact_lock`, `FOR UPDATE SKIP LOCKED`, interactive transactions. **Never use session-level advisory locks** (`pg_advisory_lock`) or `LISTEN/NOTIFY`.
- **Migrations:** run `prisma migrate deploy` with `DIRECT_URL` in the deployment pipeline **before** the new version receives traffic, not at app start (serverless has no single start). Do it in a GitHub Actions deploy job, or as the Vercel build command (`prisma migrate deploy && next build`). Because the old version keeps serving while migrations run, **every migration must be backward compatible** (expand, then contract); a column the old code still reads must not be dropped in the same release. State this rule in `docs/RUNBOOK.md`.
- Add `export const runtime = "nodejs"` to every route and page that uses Prisma, `undici` (Phase 3 SSRF-safe fetch), `node:crypto` or Twilio. Never the edge runtime. Only `middleware.ts` runs on the edge (it uses no database).
- Set `statement_timeout` for the application role as in Phase 9; keep transactions short (the 30-second sync transaction in Phase 3 stays under the function limit).

## 4. Scheduled jobs on Vercel
All jobs become **Vercel Cron** entries in `vercel.json` (UTC only). Vercel invokes cron endpoints with an HTTP **GET** and, when an environment variable named `CRON_SECRET` exists, sends it as `Authorization: Bearer <CRON_SECRET>`, which the `cronAuthorized` helper already expects.

- **Change every `POST`-only cron route to accept `GET` and `POST`** (same handler, same `cronAuthorized` check, same `withJobRun`). Manual runs keep using `POST`. Update the Phase 9 test "no GET route changes data" to exempt `/api/cron/*` (they require the secret and are the only allowed state-changing GETs), and add a test that every cron route returns 401 on GET without the secret.
- `vercel.json`:
```json
{
  "regions": ["fra1"],
  "crons": [
    { "path": "/api/cron/sync-calendars",       "schedule": "*/30 * * * *" },
    { "path": "/api/cron/send-scheduled",       "schedule": "*/10 * * * *" },
    { "path": "/api/cron/sync-templates",       "schedule": "0 * * * *" },
    { "path": "/api/cron/escalation-reminders", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/retention",            "schedule": "30 1 * * *" },
    { "path": "/api/cron/self-check",           "schedule": "*/15 * * * *" },
    { "path": "/api/cron/inbound-recovery",     "schedule": "*/5 * * * *" },
    { "path": "/api/cron/lead-follow-ups",      "schedule": "*/15 * * * *" },
    { "path": "/api/cron/weekly-summary",       "schedule": "0 6 * * 1" }
  ]
}
```
  Cron jobs run only on the **production** deployment. A schedule change needs a redeploy. Add a unit test that parses `vercel.json`, checks every expression is valid, that every `path` has a matching route file, and that the count is at most 100.
- Each route sets `export const maxDuration = 300` (check the maximum allowed on your plan and lower it if needed; calendar sync with 6 feeds should take well under a minute). Jobs must stay idempotent and at-most-once as already specified, because a function can be retried or can time out.
- **Heartbeats move into the application:** `scripts/run-cron.mjs` is no longer used. `withJobRun` (Phase 9) pings `PING_URL_<JOB>` itself after success and `<url>/fail` after failure (a plain `fetch` with a 5-second timeout whose errors are ignored).
- **Backups cannot run as a function** (no `pg_dump`). Use a scheduled **GitHub Actions** workflow `.github/workflows/backup.yml` (daily, `cron: "0 1 * * *"`) that installs the PostgreSQL 16 client, `age` and the AWS CLI, runs the same `ops/backup/backup.sh` against `DIRECT_URL` (stored as a GitHub secret), uploads the encrypted dump to the EU bucket, then pings `BACKUP_PING_URL`. GitHub schedules are best-effort and can be delayed by several minutes; the 60-day automatic disabling applies to public repositories only, but on the free plan a private repository gets a limited number of Actions minutes per month and each run is rounded up to a whole minute, so very frequent schedules are not an option there (a daily backup is fine). The heartbeat monitor catches delays and failures. Keep the restore rehearsal as written. Neon's own point-in-time restore is a useful extra, but its history window depends on the plan and it is **not** a replacement for independent backups.
- If you decide not to pay for Pro, the fallback is GitHub Actions scheduled workflows calling the same endpoints with the secret (minimum 5 minutes, delays of several minutes are common). It is acceptable for a pilot only; the self-check thresholds in Phase 9 must be widened accordingly.

## 5. Work after the response (`after()`)
`after()` works on Vercel (it keeps the function alive until the callback finishes) but the work **counts towards the function's duration and cost**.
- Webhook routes (`/api/webhooks/twilio`) set `export const maxDuration = 60`, which covers the 3-second debounce, tool rounds and one or two AI calls.
- Twilio still receives its empty TwiML response immediately.
- The Phase 9 `inbound-recovery` job already covers a function that is killed mid-processing; keep it.

## 6. Rate limiting must leave memory
The in-memory `rateLimit` (Phase 8) does not work when requests are spread across many serverless instances. Replace it with a database-backed limiter:
```prisma
model RateHit {
  id  String   @id @default(cuid())
  key String
  at  DateTime @default(now())
  @@index([key, at])
}
```
`rateLimit(key, max, windowMs)` becomes **async**: delete nothing on the hot path; count `RateHit` rows for the key within the window; if under `max`, insert one and return true. A small cleanup in the `retention` job deletes hits older than 1 day. Update all callers (`previewReply`, `sendReply`, `translate`, login guard where used, the lead and review limits) and their tests; the same tests must pass with real concurrency (`Promise.all` cannot exceed the limit by more than the number of parallel callers minus one; document the tolerance). **Exception:** the public calendar-link route (Phase 11) must not write a row per request: limit it by counting the per-token fetch record already kept (`lastFetchedAt` throttling) and rely on Vercel's platform protections for volume, and keep the 404 behaviour identical for unknown tokens.

## 7. Kill switches and settings must not need a redeploy
On Vercel a changed environment variable only affects **new deployments**, so `ASSISTANT_ENABLED=false` would not stop anything quickly. Make the switches **database-backed**:
```prisma
model AppFlag {
  key       String   @id          // ASSISTANT_ENABLED, AUTOMATIC_MESSAGES_ENABLED, WHATSAPP_MODE
  value     String
  updatedAt DateTime @updatedAt
}
```
`src/lib/flags.ts` reads `AppFlag` with a 15-second in-memory cache per instance and falls back to the environment variable default. `scripts/set-flag.ts <key> <value>` (run locally against `DIRECT_URL`) and an operator-only page `/settings/status` toggle (guarded by the owner being the operator email `OPERATOR_EMAIL`) change them within seconds. `whatsappMode()` follows the same source, with the extra rule that **`production` can only be set through the script, never from the page**. Tests: cache expiry, fallback to the environment, changes visible within the cache window, the page refuses non-operators. The runbook's kill-switch instructions use this mechanism and mention Vercel's option to promote an earlier deployment for code rollbacks.

## 8. Environments and Preview deployments
- Vercel environments: **Production**, **Preview**, **Development**. Preview deployments must **never** touch production data or send real messages: Preview variables use a separate Neon branch, `WHATSAPP_MODE=dry-run`, no Twilio auth token, no Resend key, `ANTHROPIC_API_KEY` of a low-limit key or `LLM_FAKE=1`. Protect Preview deployments with Vercel's deployment protection so webhooks and calendar links cannot be probed there.
- `APP_URL` is the production domain (custom domain, https, no trailing slash). The Twilio signature checks use `APP_URL`, so Twilio's webhook URLs point at the production domain only.
- Replace `RAILWAY_GIT_COMMIT_SHA` with `VERCEL_GIT_COMMIT_SHA` in `/api/health`. Keep `AUTH_TRUST_HOST=true`, `TRUST_PROXY=1` (Vercel sets `x-forwarded-for`), `TZ=UTC` (set it as an environment variable on the project).
- Runtime logs are kept only briefly on Vercel (about 1 hour on Hobby and 1 day on Pro, according to Vercel's limits page), so **do not rely on them**: Sentry, `JobRun` and the status page are the record. Check current log retention for your plan.
- `CRON_SECRET` must be set in Production; keep it out of Preview.

## 9. Updated deployment steps (replaces Phase 1 section 8 and the master guide's Railway table)
1. Create the Neon project (EU region): a `main` branch for production and a `dev` branch; copy the pooled and direct connection strings.
2. Create the Vercel project from the GitHub repository (Pro plan), framework Next.js, region `fra1`, Node 22. Set Production variables (`DATABASE_URL` pooled, `DIRECT_URL`, `AUTH_SECRET`, `AUTH_TRUST_HOST`, `APP_URL`, `TZ=UTC`, `TRUST_PROXY=1`, `CRON_SECRET`, plus the phase-specific variables from the master guide).
3. CI/CD: keep `ci.yml`; add a deploy step that runs `prisma migrate deploy` with `DIRECT_URL` on pushes to `main` before Vercel promotes the build (or use the build command approach in section 3).
4. Remove Railway artefacts: `railway.json`, the Railway section in `docs/RUNBOOK.md`, `scripts/run-cron.mjs`, the cron service table, and `cron-backup` as a service. Add `vercel.json`, `backup.yml` and the Neon notes.
5. Seed the owner once from a local shell against production (`SEED_ALLOW_PRODUCTION=1`), then clear those variables.
6. Verify: `/login` loads, protected pages redirect, `/api/health` is 200, a manual `POST` and a Vercel-triggered `GET` of a cron route both succeed with the secret and fail without it, the first scheduled runs appear in `JobRun` and the heartbeat monitor.

## 10. Per-phase changes (checklist for Devin)
| Phase | Change |
|---|---|
| 1 | Replace Railway section with section 9; add `directUrl`; `vercel.json`; `/api/health` uses `VERCEL_GIT_COMMIT_SHA`; migrations in the pipeline, not at start |
| 3 | Cron route accepts `GET` and `POST`; no `run-cron.mjs`; keep `runtime = "nodejs"` for the `undici` fetch; sync transaction timeout stays under `maxDuration` |
| 6 | Same cron change; `sendWhatsApp` and `after()` routes get `maxDuration`; mode from `AppFlag` |
| 7 | Webhook `maxDuration = 60`; debounce stays 3 seconds |
| 8 | Async DB-backed `rateLimit`; reminders cron accepts `GET` |
| 9 | Heartbeats inside `withJobRun`; backups via GitHub Actions; flags in the database; self-check thresholds as written; `RateHit` cleanup in retention; Sentry as written; the 30-minute and 5-minute jobs require Pro |
| 11 | Calendar-link route: `runtime = "nodejs"`, per-token throttling only, no per-request writes beyond `lastFetchedAt` |
| 12, 13 | Cron routes accept `GET`; `vercel.json` entries as in section 4 |
| Master guide | Replace the Railway services table with section 4's cron list; replace environment variables `RAILWAY_*` with `VERCEL_*`; add `DIRECT_URL` |

## 11. Extra tests
- `vercel.json` validity test (section 4).
- Cron routes: `GET` and `POST` with the secret succeed, without it return 401, and both record a `JobRun`.
- `RateHit` limiter under concurrency; cleanup removes old rows.
- Flags: database value overrides the environment, cache expires, only the operator can toggle, `production` cannot be set from the page.
- `DIRECT_URL` is used by migrations and never by the running app (assert the Prisma client is created from `DATABASE_URL`).
- Preview safety: a unit test asserts that with `VERCEL_ENV=preview` the app forces `WHATSAPP_MODE=dry-run` regardless of other settings.

## 12. Acceptance criteria
- The app runs on Vercel Pro with Neon in EU regions; all scheduled jobs run from `vercel.json` at their specified intervals, authenticated by `CRON_SECRET`; backups run from GitHub Actions with a heartbeat.
- No in-memory state is relied on for correctness (rate limits and flags use the database).
- Kill switches take effect within seconds without a redeploy; Preview deployments cannot send messages or touch production data.
- Migrations run before traffic and are backward compatible; `DIRECT_URL` is only used for migrations and backups.
- No Railway artefact remains in the repository or the documents; `lint`, `typecheck`, `test`, `build` pass and the deployment steps in section 9 were followed once end to end.
