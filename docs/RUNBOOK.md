# Ostra Runbook

## Architecture

### System Overview
Ostra is a Next.js 15 application using:
- **Frontend**: React with App Router, Tailwind CSS
- **Backend**: Next.js API routes and server actions
- **Database**: SQLite (dev) / PostgreSQL (production via Neon)
- **Auth**: Auth.js with credentials provider
- **AI**: Anthropic Claude for guest responses
- **Messaging**: Twilio WhatsApp API
- **Email**: Resend for host notifications
- **Error Tracking**: Sentry
- **Hosting**: Vercel

### Data Flow
1. **Calendar Sync**: iCal feeds → sync-calendars cron → Booking records
2. **Scheduled Messages**: send-scheduled cron → Twilio → WhatsApp
3. **Inbound Messages**: Twilio webhook → AI assistant → WhatsApp reply
4. **Escalations**: AI detection → host email → inbox
5. **Retention**: retention cron → anonymise old guest data

### Security Layers
- All `/app/**` and `/api/**` routes require authentication (except webhooks/crons)
- Webhooks verify signatures (Twilio)
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

## Rollback

If a deployment causes issues:
1. Revert the code to the previous commit
2. Redeploy
3. If database schema changed, use `npx prisma migrate resolve --applied <migration-name>` to mark it as applied without running it

## Secret Rotation

### Twilio
1. Generate new auth token in Twilio console
2. Update `TWILIO_AUTH_TOKEN` in environment variables
3. Redeploy

### Anthropic
1. Generate new API key in Anthropic console
2. Update `ANTHROPIC_API_KEY` in environment variables
3. Redeploy

### Auth Secret
1. Generate new secret: `openssl rand -base64 32`
2. Update `AUTH_SECRET` in environment variables
3. Note: This will invalidate all existing sessions; users will need to log in again

## Troubleshooting

### WhatsApp Messages Not Sending

1. Check `WHATSAPP_MODE`:
   - `dry-run`: Messages are logged but not sent (for testing)
   - `sandbox`: Uses Twilio sandbox (for development)
   - `production`: Sends real messages (requires approved templates)

2. Check Twilio console for errors:
   - Look for failed message deliveries
   - Verify the phone number format (E.164: + country code + number)

3. Check scheduled message status in the booking detail page

### Calendar Sync Failing

1. Check the iCal URL is accessible
2. Check the last sync time and error message in the apartment page
3. Manually trigger sync from the apartment page

### AI Assistant Not Responding

1. Check `ANTHROPIC_API_KEY` is set
2. Check rate limits in booking detail page
3. Test with the "Test assistant" page

## Twilio Configuration

### WhatsApp Webhook Setup

1. In the Twilio console, go to Messaging > Settings > WhatsApp sandbox settings (or your WhatsApp sender number)
2. Set "When a message comes in" to: `${APP_URL}/api/webhooks/twilio`
3. Method: `POST`
4. Important: The URL must match exactly with `APP_URL` in your environment variables (no trailing slash)
5. The webhook validates the `X-Twilio-Signature` header using `TWILIO_AUTH_TOKEN`

### WhatsApp Sender Number

For production:
1. Apply for a WhatsApp Business Profile through Twilio
2. Get your sender number approved
3. Set `TWILIO_WHATSAPP_FROM` to your number (e.g., `whatsapp:+1234567890`)
4. Submit message templates for approval (pre-arrival, check-in, check-out, review request)

For development:
- Use the Twilio WhatsApp Sandbox
- Set `TWILIO_WHATSAPP_FROM=whatsapp:+14155238886` (sandbox number)
- Set `WHATSAPP_MODE=sandbox`

### Status Callback

The delivery status webhook is at `${APP_URL}/api/webhooks/twilio-status`
- This is automatically configured in `sendWhatsApp` function
- Updates message delivery status in the database

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
1. Check `WHATSAPP_MODE`:
   - `dry-run`: Messages logged but not sent (for testing)
   - `sandbox`: Uses Twilio sandbox (for development)
   - `production`: Sends real messages (requires approved templates)
2. Check Twilio console for errors
3. Verify phone numbers are in E.164 format (+ country code + number)
4. Check template approval status in Twilio
5. Verify status callback is receiving updates

### Calendar Sync Failing
**Symptoms**: Bookings not appearing, apartment page shows sync error

**Steps**:
1. Manually test iCal URL accessibility
2. Check feed URL ends with `.ics` or returns `text/calendar`
3. Verify no recent changes to platform export settings
4. Check retention/cron job runs in /settings/status
5. Run sync manually from apartment page

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
