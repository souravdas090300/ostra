# Ostra Runbook

## Architecture

### System Overview

Ostra is a Next.js 15 application using:

- **Frontend**: React with App Router, Tailwind CSS
- **Backend**: Next.js API routes and server actions
- **Database**: PostgreSQL via Prisma; tests use a disposable local PostgreSQL database
- **Auth**: Auth.js with credentials provider
- **AI**: Anthropic Claude for guest responses
- **Messaging**: Meta WhatsApp Cloud API
- **Email**: Resend for host notifications
- **Error Tracking**: Sentry
- **Hosting**: Undecided. Vercel pull-request checks are not a production hosting decision.

### Data Flow

1. **Calendar Sync**: iCal feeds → sync-calendars cron → Booking records
2. **Scheduled Messages**: send-scheduled cron → Meta WhatsApp Cloud API
3. **Inbound Messages**: Meta webhook → AI assistant → WhatsApp reply
4. **Escalations**: AI detection → host email → inbox
5. **Retention**: retention cron → anonymise old guest data

### Security Layers

- All `/app/**` and `/api/**` routes require authentication (except webhooks/crons)
- Webhooks verify Meta signatures against the raw request body
- Crons verify `CRON_SECRET` header
- Login rate limiting with hashed attempts
- All queries scoped by `ownerId`
- No secrets in code (environment variables only)
- Security headers (CSP, HSTS, X-Frame-Options, etc.)

## Deployment

### Database Migration

```bash
npx prisma migrate deploy
```

### Environment Variables

Copy the appropriate environment file:

- Local development: `cp .env.dev .env`
- Production: `cp .env.prod .env` (then fill in actual values)

### Build

```bash
npm run build
```

## Pre-release CI and branch-promotion checks

Before promoting `develop` to `main`, confirm the current commit's required CI checks pass and complete the following:

- **Test isolation:** Vitest is configured with `fileParallelism: false`, and its configuration refuses any database URL other than the local disposable `ostra_test` database. Run `npm test` three times sequentially against that database. All three totals must match with zero failures; investigate any difference before release.
- **Gitleaks:** CI runs the pinned `gitleaks/gitleaks-action` (`e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e`) against full checkout history (`fetch-depth: 0`). This is blocking. Review the CI job log and require no leaks.
- **Semgrep:** runs `p/default`, `p/typescript`, and `p/security-audit` with `--error`. Findings are non-blocking because `continue-on-error` is set on the scan step; they appear in the job log but do not fail the PR check. Before promotion, open the latest Semgrep job and confirm it reports zero findings. Latest verified scan (2026-11-03): 250 rules, 233 files, zero findings.
- **npm audit:** the production dependency tree currently reports five affected package entries for two moderate advisories: CVE-2026-118773 (`glob@13.0.6`, GHSA-3g3m-2fjr-6pw4) and CVE-2026-118764 (`minimatch@10.2.6`, GHSA-g3hv-75wg-m249). These are transitive dependencies under `@sentry/nextjs` → `@sentry/bundler-plugins`; they are not dev-only. The first advisory concerns filesystem traversal continuing after glob cancellation; the second concerns denial of service from glob-pattern amplification. No app code passes guest-controlled patterns to these APIs, and `next.config.mjs` does not invoke Sentry's bundler configuration, but that does not remove the production dependency finding. Sentry 11.10.0 and its bundler plugin 11.10.0 are the latest available in their current major lines; the plugin still requires glob 13. npm audit offered `@sentry/nextjs@10.76.1` with `isSemVerMajor: true`; a trial left the same vulnerable glob/minimatch versions and increased the production audit to six moderate package entries, so it was reverted. No in-major fix has been verified. The exact-ID exceptions remain temporary and are enforced by CI through 2026-12-02 UTC. Review and remove or renew them before 2026-12-03.
- **Snyk:** GitHub reports an external `security/snyk (souravdas090300)` status, not a workflow in this repository. Its latest status said “No manifest changes detected in 1 project”; do not treat that message as a completed vulnerability scan. Confirm the Snyk organization/project settings with the repository owner if its use or ownership is unclear.
- **Vercel:** GitHub reports Vercel deployment checks for pull requests. The checks show deployments completed, but do not establish that the URLs are preview-only/private or that production auto-deploy is disabled. Verify the Vercel project's access controls and production-branch settings before using it for a pilot.

## Rollback

If a deployment causes issues:

1. Revert the code to the previous commit
2. Redeploy
3. If database schema changed, use `npx prisma migrate resolve --applied <migration-name>` to mark it as applied without running it

## Secret Rotation

### Meta WhatsApp

1. Rotate the system-user access token in Meta Business settings.
2. Update `META_ACCESS_TOKEN` and verify `META_APP_SECRET` remains current.
3. Redeploy, then verify the webhook handshake and one sandbox message.

### Anthropic

1. Generate new API key in Anthropic console
2. Update `ANTHROPIC_API_KEY` in environment variables
3. Redeploy

### Auth Secret

1. Generate new secret: `openssl rand -base64 32`
2. Update `AUTH_SECRET` in environment variables
3. Note: This will invalidate all existing sessions; users will need to log in again

### Export Token Rotation

If an export link is leaked or compromised:

1. In the apartment page, click "Make a new link" for the affected platform
2. The old link will stop working immediately (returns 404)
3. Copy the new link and update it in the platform (Airbnb/Booking.com calendar settings)
4. The platform may take a few hours to read the new link
5. Monitor the status page to confirm the platform is reading the new link

**Note**: Regenerating a link resets the fetch count and confirmation state. The host must re-confirm that they added the link in the platform.

## Troubleshooting

### WhatsApp Messages Not Sending

1. Check `WHATSAPP_MODE`: dry-run makes no external calls; sandbox uses Meta's test number and the configured recipient allow-list; production uses approved templates.
2. Check the scheduled message status and error code in the booking detail page.
3. Confirm `META_API_VERSION`, `META_ACCESS_TOKEN`, and `META_PHONE_NUMBER_ID` are set; template management also needs `META_WABA_ID`.
4. Check the WhatsApp product's Meta App Dashboard for delivery or template errors.

### Calendar Sync Failing

1. Check the iCal URL is accessible
2. Check the last sync time and error message in the apartment page
3. Manually trigger sync from the apartment page

### AI Assistant Not Responding

1. Check `ANTHROPIC_API_KEY` is set
2. Check rate limits in booking detail page
3. Test with the "Test assistant" page

## Meta WhatsApp Configuration

1. Configure the Meta app webhook at `${APP_URL}/api/webhooks/meta`; subscribe to `messages` and `message_template_status_update`.
2. Set `META_API_VERSION`, `META_ACCESS_TOKEN`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_WABA_ID`, and `META_PHONE_NUMBER_ID`.
3. For sandbox mode, set `META_SANDBOX_ALLOWED_NUMBERS` to comma-separated E.164 test recipients. Messages to other recipients are rejected before any network call.
4. For production, use a permanent system-user token and a registered, approved sender. Submit each translation for approval in Ostra.
5. Status webhooks update approval and delivery state; the hourly `sync-templates` cron reconciles template approvals if a webhook is missed.

## Email Notifications

To enable email notifications for escalations:

1. Sign up for Resend (https://resend.com)
2. Get your API key
3. Set `RESEND_API_KEY` in environment variables
4. Set `NOTIFY_FROM` to your sender email (e.g., `noreply@yourdomain.com`)
5. Without these, notifications run in dry-run mode and only log that one would be sent

## Incident Playbooks

### AI Assistant Not Responding

**Symptoms**: Guests receive holding messages, inbox shows escalation "assistant unavailable"

**Steps**:

1. Check Sentry for errors
2. Verify `ANTHROPIC_API_KEY` is set and valid
3. Check if monthly AI budget is exceeded (see /settings/usage)
4. Verify `ASSISTANT_ENABLED=true` in environment
5. Test Anthropic API directly:
   ```bash
   curl https://api.anthropic.com/v1/messages \
     -H "x-api-key: $ANTHROPIC_API_KEY" \
     -H "anthropic-version: 2023-06-01" \
     -H "content-type: application/json" \
     -d '{"model":"claude-sonnet-5-5","max_tokens":10,"messages":[{"role":"user","content":"test"}]}'
   ```

### WhatsApp Messages Not Sending

**Symptoms**: Scheduled messages show "FAILED", guests report not receiving messages

**Steps**:

1. Check `WHATSAPP_MODE` and the recipient allow-list when using sandbox.
2. Verify phone numbers are in E.164 format (+ country code + number).
3. Check the Meta App Dashboard and Ostra's template approval/category status.
4. Confirm the Meta webhook is subscribed and the `sync-templates` cron is healthy.

### Calendar Sync Failing

**Symptoms**: Bookings not appearing, apartment page shows sync error

**Steps**:

1. Manually test iCal URL accessibility
2. Check feed URL ends with `.ics` or returns `text/calendar`
3. Verify no recent changes to platform export settings
4. Check retention/cron job runs in /settings/status
5. Run sync manually from apartment page

### Export Link Issues

**Symptoms**: Platform not blocking dates, export link stale, suspected feedback loop

**Steps**:

1. Check export link status in apartment page (Off, Waiting, Connected, Stale)
2. Verify the platform has imported the link correctly
3. Check if the platform has read the link recently (last read time)
4. If stale (>48 hours since last read), check platform calendar import settings
5. If suspected feedback loop (see docs/EXPORT_TEST.md):
   - Turn off the export link immediately
   - Ask the host to remove the import on the platform
   - Cancel any mirror bookings the platform created by removing the imported events through the next sync
   - Check the calendar by hand
   - Do not re-enable until the loop test passes again

### Database Connection Issues

**Symptoms**: 500 errors, timeouts, connection refused

**Steps**:

1. Check `DATABASE_URL` is correct
2. Verify database is accepting connections
3. Check for connection pool exhaustion
4. Restart deployment if needed
5. Check database metrics (connection count, CPU, memory)

### High AI Costs

**Symptoms**: Unexpectedly high usage in /settings/usage

**Steps**:

1. Check for loops or bugs causing excessive AI calls
2. Review guest escalation rate (are guests asking questions AI can't answer?)
3. Consider adjusting AI pricing in environment variables
4. Lower monthly budget if needed
5. Check for spam or abuse from unknown numbers

## Restore Procedure

### Database Backup Restore

**Prerequisites**: Database backup file, access to restore environment

**Steps**:

1. Stop the application (scale to 0 or pause deployment)
2. Restore database from backup:
   ```bash
   # Neon
   psql $DATABASE_URL < backup.sql
   # Or use Neon console UI
   ```
3. Run migrations to ensure schema is current:
   ```bash
   npx prisma migrate deploy
   ```
4. **CRITICAL**: Run retention job to delete data past retention period:
   ```bash
   curl -X POST https://your-app.com/api/cron/retention?dryRun=0 \
     -H "Authorization: Bearer $CRON_SECRET"
   ```
5. Verify data integrity:
   - Check recent bookings exist
   - Verify message counts
   - Check job runs in /settings/status
6. Restart application
7. Test critical flows:
   - Login
   - View calendar
   - Send test message
8. Monitor Sentry for errors post-restore

### Data Verification Checklist

- [ ] Owner accounts intact
- [ ] Apartments and feeds present
- [ ] Recent bookings (last 30 days) present
- [ ] Message history accessible
- [ ] Scheduled messages preserved
- [ ] Opt-out hashes intact
- [ ] Usage data accurate

## Checklists

### Monthly Checklist

- [ ] Review AI and WhatsApp usage in /settings/usage
- [ ] Check budget warnings and adjust if needed
- [ ] Review escalation patterns (add missing info to apartments)
- [ ] Verify calendar feeds are syncing correctly
- [ ] Check export link status (stale links, waiting too long)
- [ ] Check for failed scheduled messages
- [ ] Review and update message templates
- [ ] Check Sentry for recurring errors
- [ ] Verify backup completion (if automated)
- [ ] Review opt-out requests

### Quarterly Checklist

- [ ] Review and update processor list in docs/DATA_PROTECTION.md
- [ ] Test retention job with dry-run
- [ ] Review security headers configuration
- [ ] Update dependencies (npm audit)
- [ ] Review and test restore procedure
- [ ] Check DPA template currency
- [ ] Review guest notice for accuracy
- [ ] Audit access controls (who has operator access)

### Onboarding Checklist (New Host)

- [ ] Create owner account
- [ ] Configure host language and preferences
- [ ] Add apartments with names, addresses, check-in/out times
- [ ] Fill in apartment info (Wi-Fi, key/lockbox, house rules, etc.)
- [ ] Add iCal feeds from booking platforms
- [ ] Test calendar sync
- [ ] Run the loop test for calendar export (see docs/EXPORT_TEST.md)
- [ ] Enable export links for each platform after loop test passes
- [ ] Configure WhatsApp (sandbox first, then production)
- [ ] Set up message templates (get approved for production)
- [ ] Add phone numbers to upcoming bookings
- [ ] Test end-to-end with a real booking
- [ ] Share privacy page link with guests
- [ ] Train host on inbox and escalation handling

### Offboarding Checklist (Host Leaving)

- [ ] Export all guest data (run scripts/export-owner-data.mjs)
- [ ] Delete guest data after host confirmation (run scripts/delete-owner-data.mjs)
- [ ] Remove access to owner account
- [ ] Disable WhatsApp sender for this owner
- [ ] Archive or delete owner record (after retention period)
- [ ] Update processor list if host was acting as processor
- [ ] Keep opt-out hashes for compliance period
