# Ostra Scheduler

The Ostra scheduler uses a single tick endpoint to run all background jobs, replacing the previous "one cron service per job" architecture.

## Overview

Instead of configuring separate cron services for each job (send-scheduled, sync-calendars, etc.), the scheduler uses:
- One endpoint: `POST /api/cron/tick` (also accepts GET)
- One cron driver (every minute) that calls this endpoint
- The endpoint decides which jobs are due and runs them
- A lease system ensures only one instance runs each job at a time

## Job Registry

All jobs are defined in `src/lib/jobs.ts`:

```typescript
export const JOBS: JobDef[] = [
  { name: "send-scheduled",       every: 5,  run: sendDueMessagesJob },
  { name: "inbound-recovery",     every: 5,  run: inboundRecoveryJob },
  { name: "sync-calendars",       every: 30, run: syncAllFeedsJob, maxDuration: 20 },
  { name: "escalation-reminders", every: 15, run: escalationRemindersJob },
  { name: "self-check",           every: 15, run: selfCheckJob },
  {name: "lead-follow-ups",      every: 15, run: leadFollowUpsJob },
  { name: "sync-templates",       every: 60, run: syncApprovalsJob },
  { name: "retention",            at: { hourUtc: 1, minute: 30 }, run: retentionJob, maxDuration: 20 },
  { name: "weekly-summary",       at: { hourUtc: 6, minute: 0, weekdayUtc: 1 }, run: weeklySummaryJob },
];
```

Jobs can be:
- **Interval-based**: `every: N` (runs every N minutes)
- **Fixed-time**: `at: { hourUtc, minute, weekdayUtc? }` (runs at specific UTC time)

## Scheduling Logic

A job is due when:
- **Interval jobs**: Last run was at least `every` minutes ago (with 30-second tolerance)
- **Fixed-time jobs**: Current time is at or past the scheduled time, and last run was before that time

**Catch-up behavior**: After an outage, a job runs once, not multiple times for missed slots.

## Lease System

To prevent multiple instances from running the same job:
- Each job has a lease in the `JobLease` table
- Lease is claimed atomically before running
- Lease expires after the job's max duration (default 10 minutes)
- If lease claim fails, another runner is holding it - skip

```sql
INSERT INTO "JobLease" ("job", "leasedUntil") VALUES ($1, now() + $2::interval)
ON CONFLICT ("job") DO UPDATE SET "leasedUntil" = EXCLUDED."leasedUntil"
WHERE "JobLease"."leasedUntil" < now()
RETURNING "job"
```

## Cron Drivers

Choose one driver based on your deployment:

### VPS (system cron)

Add to crontab:
```bash
* * * * * curl -fsS -m 55 -H "Authorization: Bearer $CRON_SECRET" https://YOUR_DOMAIN/api/cron/tick >/dev/null || true
```

### In-process (single-instance)

Set environment variable:
```bash
ENABLE_IN_PROCESS_SCHEDULER=1
```

The scheduler starts automatically in `instrumentation.ts` when:
- `ENABLE_IN_PROCESS_SCHEDULER=1`
- `NEXT_RUNTIME=nodejs`
- Only one instance is running

**Never enable in-process on multiple instances without the lease** (the lease is already in place, so it's safe, but unnecessary overhead).

### Render

Option 1: One cron job service every 5 minutes calling `/api/cron/tick` (minimum charge per cron service applies).

Option 2: In-process driver on an always-on paid web service (no separate cron service needed).

### External scheduler

Use a hosted cron service (e.g., Cron-job.org, EasyCron) or Cloudflare Worker calling `/api/cron/tick` every 5 minutes. Add a heartbeat monitor (`PING_URL_TICK`) because free schedulers have no guarantees.

## Backups

Backups are NOT part of the tick (they need `pg_dump`). Run separately:

**VPS**: Add to system crontab at 01:00 UTC:
```bash
0 1 * * * /path/to/ops/backup/backup.sh && curl -fsS $BACKUP_PING_URL >/dev/null || true
```

**Render**: Use a separate cron job service or a scheduled GitHub Actions workflow.

## Environment Variables

Add to `.env`:

```bash
# Scheduler tick heartbeat (optional)
PING_URL_TICK=

# In-process scheduler (only for single-instance deployments)
ENABLE_IN_PROCESS_SCHEDULER=0

# Job-specific heartbeats (optional)
PING_URL_SEND_SCHEDULED=
PING_URL_LEAD_FOLLOW_UPS=
PING_URL_WEEKLY_SUMMARY=
# ... (one per job)
```

## Time Budget

The tick endpoint has a 50-second time budget. If jobs are taking too long, it stops starting new jobs and lets the remaining due jobs run on the next tick. This prevents the tick from running indefinitely.

Jobs with longer max duration (e.g., `sync-calendars` with 20 minutes) are placed last in the registry so they're the first to be skipped when time is short.

## Manual Job Runs

Individual job endpoints remain available for manual runs and testing:
- `POST /api/cron/send-scheduled`
- `POST /api/cron/sync-calendars`
- `POST /api/cron/self-check`
- etc.

These are useful for:
- Testing job logic
- Manual triggers
- Debugging

## Monitoring

### Health Checks

The `self-check` job now monitors:
- Whether `tick` itself has not run (no JobRun for any job in 5 minutes)
- Whether any job is overdue by more than twice its interval

### Heartbeat Monitoring

Configure heartbeat URLs to detect stopped schedulers:
- `PING_URL_TICK`: Pings after every successful tick
- `PING_URL_<JOB_NAME>`: Pings after each job completes

Use UptimeRobot, Healthchecks.io, or similar services.

### Status Page

The status page (`/settings/status`) shows:
- Last start time for each job
- Last result (success/failure)
- Next due time
- Lease state

## Migration from Per-Job Crons

If migrating from the old per-job cron architecture:

1. **Remove per-job cron services**: Delete all individual cron job configurations
2. **Add single tick cron**: Configure one cron to call `/api/cron/tick` every minute
3. **Verify jobs run**: Check the status page and JobRun table
4. **Remove old endpoints** (optional): Keep individual job endpoints for manual use, or remove if not needed

## Testing

Run the scheduler tests:
```bash
npm test -- scheduler.test.ts
npm test -- tick.test.ts
npm test -- lease.test.ts
```

Tests cover:
- Interval and fixed-time scheduling logic
- Lease claiming and release
- Concurrent tick handling
- Time budget enforcement
- Error isolation between jobs
