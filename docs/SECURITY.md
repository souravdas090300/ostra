# Ostra Security

## Secrets

This document lists all secrets used in Ostra, where they are used, and how to rotate them.

### Environment Variables

| Secret | Used By | Purpose | Rotation Procedure |
|--------|---------|---------|-------------------|
| `DATABASE_URL` | Prisma | Database connection | Generate new connection string in Railway console, update Railway variables, redeploy |
| `AUTH_SECRET` | NextAuth | Session encryption | Generate with `openssl rand -base64 32`, update Railway variables, redeploy (invalidates all sessions) |
| `ANTHROPIC_API_KEY` | Anthropic SDK | AI API access | Generate new key in Anthropic console, update Railway variables, redeploy |
| `TWILIO_ACCOUNT_SID` | Twilio SDK | WhatsApp API access | Cannot rotate SID, use new account if needed |
| `TWILIO_AUTH_TOKEN` | Twilio SDK | WhatsApp API authentication | Generate new token in Twilio console, update Railway variables, redeploy |
| `CRON_SECRET` | Cron endpoints | Cron job authentication | Generate with `openssl rand -base64 32`, update Railway variables, redeploy |
| `DATA_PEPPER` | Hashing | Phone and email hashing | Generate long random secret, update Railway variables, redeploy (opt-out hashes will change) |
| `SENTRY_DSN` | Sentry | Error reporting | Generate new DSN in Sentry console, update Railway variables, redeploy |
| `SENTRY_AUTH_TOKEN` | Sentry build | Source map upload | Generate new token in Sentry console, update Railway variables, redeploy |
| `RESEND_API_KEY` | Resend | Email notifications | Generate new key in Resend console, update Railway variables, redeploy |
| `AGE_PRIVATE_KEY` | Backup decryption | Backup decryption | Never store in Railway; keep offline in password manager; rotate by generating new key and re-encrypting backups |
| `AWS_ACCESS_KEY_ID` | Backup storage | S3/R2 access | Generate new key in Cloudflare/Backblaze console, update Railway variables, redeploy |
| `AWS_SECRET_ACCESS_KEY` | Backup storage | S3/R2 authentication | Generate new key in Cloudflare/Backblaze console, update Railway variables, redeploy |

### Application-Generated Secrets

| Secret | Stored In | Purpose | Properties | Rotation Procedure |
|--------|-----------|---------|------------|-------------------|
| Export tokens | Database (ExportFeed.token) | Calendar export link authentication | 192 bits (32 chars base64url), unique per apartment/platform, revocable | Regenerate from apartment page (old token stops working immediately) |

### Rotation Notes

- **DATA_PEPPER**: Rotating this will change all phone/email hashes. Existing opt-outs will need to be re-created. Plan this carefully.
- **AUTH_SECRET**: Rotating this will invalidate all existing sessions. Users will need to log in again.
- **AGE_PRIVATE_KEY**: Never store this in Railway or the repository. Keep a printed copy offline. Rotation requires generating a new key and re-encrypting all existing backups.

## Security Headers

The application implements the following security headers:
- Content-Security-Policy
- Strict-Transport-Security
- X-Content-Type-Options
- X-Frame-Options
- Referrer-Policy
- Permissions-Policy

See `next.config.mjs` for the current configuration.

## Authentication

- Passwords are hashed with bcrypt (cost 12)
- Login attempts are rate-limited (5 failures per email in 15 minutes, 20 failures per IP in 1 hour)
- Sessions use JWT with HttpOnly, Secure, SameSite=Lax cookies
- Password changes invalidate all existing sessions

## API Security

- All `/api/**` and `/app/**` routes require a session (except webhooks and crons)
- Webhooks verify signatures (Twilio `X-Twilio-Signature`)
- Cron jobs verify `Authorization: Bearer CRON_SECRET` header
- Server actions check the `Origin` header
- All queries are scoped by `ownerId`

## Logging and Error Reporting

- No personal data appears in logs (phone numbers, message text, names, URLs are scrubbed)
- Sentry events are scrubbed before sending (request data, cookies, headers, user removed)
- Only allow-listed fields are logged (see `lib/log.ts`)

## Supply Chain Security

- `npm audit --omit=dev --audit-level=high` runs in CI
- gitleaks secret scan runs in CI
- Dependabot configured for weekly dependency updates
- Prisma schema drift check runs in CI

## Backups

- Nightly encrypted backups to S3-compatible storage (Cloudflare R2 or Backblaze B2)
- Backups encrypted with age using a public key
- Private key kept offline (password manager + printed copy)
- Restore procedure documented in `docs/RESTORE.md`

## Incident Response

### Detection
- Sentry error alerts
- Self-check cron job alerts (stale jobs, failed messages, urgent escalations)
- Heartbeat monitoring (cron job pings)

### Containment
- Kill switches: `ASSISTANT_ENABLED=false`, `AUTOMATIC_MESSAGES_ENABLED=false`, `WHATSAPP_MODE=dry-run`
- Scale web service to zero if needed
- Change compromised secrets

### Eradication
- Identify and fix the root cause
- Rotate any compromised secrets
- Review audit logs for unauthorized access

### Recovery
- Restore from backup if data was corrupted
- Re-enable services
- Monitor for recurrence

### Lessons Learned
- Document the incident
- Update procedures as needed
- Consider disclosure to affected parties if required

## Third-Party Security

- Anthropic: Uses Claude API with usage limits
- Twilio: Uses WhatsApp with template approval
- Railway: Hosting with platform security
- Sentry: Error reporting with EU region
- Resend: Email with API key authentication

See `/privacy` page for the full processor list.

---

**Note**: This document is for internal operational use. Keep it updated with any changes to secrets or security procedures.
