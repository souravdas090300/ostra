# Ostra scheduler: one `tick` that runs whatever is due

> **For Devin:** replaces the "one cron service per job" tables in `OSTRA_MASTER_GUIDE.md` and the per-job Railway, Render and Vercel cron instructions. Implement once; it works unchanged on a VPS, on Render, or anywhere with a long-running Node server. Existing `/api/cron/<job>` routes stay (for manual runs and tests).

## 1. Why
Jobs must run **frequently** (every 5 to 30 minutes, not once a day) but separate cron services cost extra and multiply configuration. One scheduler calls one endpoint every minute; the endpoint decides which jobs are due, makes sure only one instance runs each, and records every run.

## 2. Job registry: `src/lib/jobs.ts`
```ts
export type JobDef =
  | { name: string; every: number; run: () => Promise<Record<string, number>> }                     // minutes between runs
  | { name: string; at: { hourUtc: number; minute: number; weekdayUtc?: number }; run: () => Promise<Record<string, number>> };

export const JOBS: JobDef[] = [
  { name: "send-scheduled",       every: 5,  run: sendDueMessagesJob },
  { name: "inbound-recovery",     every: 5,  run: inboundRecoveryJob },
  { name: "sync-calendars",       every: 30, run: syncAllFeedsJob },
  { name: "escalation-reminders", every: 15, run: escalationRemindersJob },
  { name: "self-check",           every: 15, run: selfCheckJob },
  { name: "lead-follow-ups",      every: 15, run: leadFollowUpsJob },
  { name: "sync-templates",       every: 60, run: syncApprovalsJob },
  { name: "retention",            at: { hourUtc: 1, minute: 30 }, run: retentionJob },
  { name: "weekly-summary",       at: { hourUtc: 6, minute: 0, weekdayUtc: 1 }, run: weeklySummaryJob },
];
```
Each `run` is the existing job function from its phase (they already return flat count objects). Backups stay outside the app (section 6).

## 3. When is a job due: `isDue(job, lastStartedAt, now)`
- Interval jobs: due when `lastStartedAt` is missing or `now - lastStartedAt >= every minutes - 30 seconds` (tolerance so a tick that arrives a few seconds early does not skip a slot).
- Fixed-time jobs: due when `now` is at or after today's scheduled time (and on the right weekday), and `lastStartedAt` is before that scheduled time.
- **Catch-up runs once:** after an outage a job that missed ten slots runs **once**, never ten times.
- Last start time comes from `JobRun` (Phase 9), the most recent row per job, regardless of success. A failing job therefore retries at its normal interval, not in a loop.

## 4. Single runner per job: a lease
```prisma
model JobLease {
  job         String   @id
  leasedUntil DateTime
}
```
Claim atomically before running (works through any connection pooler, no session locks):
```sql
INSERT INTO "JobLease" ("job", "leasedUntil") VALUES ($1, now() + $2::interval)
ON CONFLICT ("job") DO UPDATE SET "leasedUntil" = EXCLUDED."leasedUntil"
WHERE "JobLease"."leasedUntil" < now()
RETURNING "job"
```
No returned row means another runner holds it: skip. The lease length is the job's maximum duration (default 10 minutes, `retention` and `sync-calendars` 20). Release by setting `leasedUntil = now()` when the job finishes. A crashed runner's lease expires by itself.

## 5. The endpoint and the drivers
`POST` and `GET` `/api/cron/tick` (`cronAuthorized`, `runtime = "nodejs"`):
1. Load the last start per job in one query.
2. For each due job in registry order: claim the lease, run it inside `withJobRun` (Phase 9) with its heartbeat ping, release the lease. A thrown error is recorded and does **not** stop the other jobs.
3. Respect a **time budget** (default 50 seconds): stop starting new jobs when it is used up; the remaining due jobs run on the next tick. (`sync-calendars` on its own may take longer; it is simply the last to start when time is short, and its lease keeps a second tick from starting it again.)
4. Return `{ ran: ["send-scheduled", ...], skipped: n, failed: n }` (names and counts only).
Kill switches still apply inside each job (`AUTOMATIC_MESSAGES_ENABLED`, `ASSISTANT_ENABLED`).

Drivers (use one; the lease makes it safe if two overlap):
- **VPS:** system cron every minute: `* * * * * curl -fsS -m 55 -H "Authorization: Bearer $CRON_SECRET" https://YOUR_DOMAIN/api/cron/tick >/dev/null || true`.
- **In-process (test or one-server setups):** `src/instrumentation.ts` starts `setInterval(tick, 60_000)` when `ENABLE_IN_PROCESS_SCHEDULER=1` and `NEXT_RUNTIME === "nodejs"`; it calls the tick function directly (not over HTTP), guards against double registration in development, and does nothing on any other runtime. Never enable it on more than one running instance without the lease (which is already in place).
- **Render:** one cron job service every 5 minutes calling the same URL (minimum charge per cron service applies), or the in-process driver on an always-on paid web service.
- **External free scheduler (optional):** a hosted cron or a Cloudflare Worker calling the URL every 5 minutes; add a heartbeat monitor because free schedulers have no guarantees.

## 6. Backups
Not part of the tick (they need `pg_dump`). On a VPS run `ops/backup/backup.sh` from the system crontab at 01:00 UTC and ping `BACKUP_PING_URL`; on Render use a cron job service or a scheduled GitHub Actions workflow. Restore rehearsal rules from Phase 9 are unchanged.

## 7. Health and monitoring
- The Phase 9 `self-check` job now alerts when `tick` itself has not run (no `JobRun` for any job in 5 minutes) and when any job is overdue by more than twice its interval.
- A heartbeat monitor (UptimeRobot, Healthchecks or similar) pings from the `tick` endpoint's success path (`PING_URL_TICK`) so a stopped scheduler is noticed from outside.
- The status page lists each job with last start, last result, next due time and lease state.

## 8. Tests
- `isDue`: interval boundaries with tolerance; never run; fixed-time daily and weekly across midnight UTC and across weeks; catch-up after a long gap returns due once; clock changes do not matter (UTC).
- Lease: two concurrent ticks start each job once (`Promise.all`); an expired lease is taken over; a held lease is skipped; release works; a job that throws still releases its lease.
- Tick: runs only due jobs, in order; a failing job does not stop others and is recorded; the time budget stops new jobs; the second tick one minute later runs nothing that is not due; kill switches are respected; unauthorised calls return 401; `GET` and `POST` both work.
- In-process driver: registers once, only on the Node runtime, only when enabled.
- End to end on a test database with fake clocks: simulate 24 hours of ticks every minute and assert the run counts per job (for example `send-scheduled` about 288 times, `retention` once).

## 9. Acceptance criteria
- Every job runs at its configured frequency (the shortest every 5 minutes), never twice at once, and never in a burst after an outage.
- One scheduler configuration (one URL, one secret) replaces all per-job cron services.
- Failures are isolated, recorded and alerted; a stopped scheduler is detected from outside within minutes.
- The same code runs on a VPS and on Render without changes; `lint`, `typecheck`, `test`, `build` pass.
