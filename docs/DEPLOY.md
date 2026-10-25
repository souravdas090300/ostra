# Railway Deployment Guide

This document covers deploying Ostra on Railway with PostgreSQL.

## Prerequisites

- GitHub repository with the Ostra code
- Railway account (requires credit card on Hobby plan)
- Environment variables ready (see `.env.example`)

## Step 1: Create Railway Project

1. Go to [railway.app](https://railway.app) and sign in
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your Ostra repository
4. Choose the branch to deploy (use `main` for production)

## Step 2: Add PostgreSQL Service

1. In your Railway project, click "New Service"
2. Select "Database" → "PostgreSQL"
3. Railway will create a PostgreSQL instance
4. Note the service name (e.g., `postgres-xxxxx`)

## Step 3: Configure Web Service

Your repository will be imported as a web service. Configure it:

### Build Settings
- **Build Command**: `npm run build`
- **Start Command**: `npx prisma migrate deploy && npm run start`

### Environment Variables

Click the web service → "Variables" → "New Variable":

Required variables:
```
DATABASE_URL={{postgres.DATABASE_URL}}
AUTH_SECRET=<generate with openssl rand -base64 32>
CRON_SECRET=<generate with openssl rand -base64 32>
APP_URL=<your Railway web service URL>
AUTH_TRUST_HOST=true
TZ=UTC
```

Optional but recommended:
```
ANTHROPIC_API_KEY=<from Anthropic console>
ANTHROPIC_MODEL=claude-sonnet-5-5
TWILIO_ACCOUNT_SID=<from Twilio console>
TWILIO_AUTH_TOKEN=<from Twilio console>
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
WHATSAPP_MODE=dry-run
MAX_TEMPLATE_SENDS_PER_DAY=100
MAX_AI_REPLIES_PER_DAY=300
```

**Important**: For `DATABASE_URL`, use Railway's variable reference button (`{{postgres.DATABASE_URL}}`) to automatically link to your PostgreSQL service.

## Step 4: Add Cron Services

Each cron job is a separate service that runs a script:

### Calendar Sync (every 30 minutes)
1. Click "New Service" → "GitHub Repo" → select your repository
2. Build Command: `npm run build`
3. Start Command: `npx tsx api/cron/sync-calendars.ts`
4. Environment: Copy all variables from the web service
5. Cron: Set schedule to `*/30 * * * *` in Railway's cron settings

### Scheduled Messages (every 10 minutes)
1. Create similar service
2. Start Command: `npx tsx api/cron/send-scheduled.ts`
3. Cron: `*/10 * * * *`

### Template Sync (every hour)
1. Create similar service
2. Start Command: `npx tsx api/cron/sync-templates.ts`
3. Cron: `0 * * * *`

### Retention Cleanup (daily)
1. Create similar service
2. Start Command: `npx tsx api/cron/retention.ts`
3. Cron: `0 2 * * *` (2 AM UTC)

### Self-Check (every 5 minutes)
1. Create similar service
2. Start Command: `npx tsx api/cron/self-check.ts`
3. Cron: `*/5 * * * *`

## Step 5: Create First Owner

1. Go to your web service in Railway
2. Click "Console" to open a shell
3. Run:
```bash
npx tsx prisma/seed.ts --allow-production
```
4. Set environment variables:
```
SEED_OWNER_EMAIL=your-email@example.com
SEED_OWNER_PASSWORD=your-secure-password (min 12 chars)
```
5. After the owner is created, remove the seed variables

## Step 6: Configure Health Check

1. On your web service, go to "Settings" → "Health Check"
2. Path: `/api/health`
3. Railway will monitor this endpoint

## Step 7: Verify Deployment

1. Open your Railway web service URL
2. Should redirect to `/login`
3. Sign in with the seeded owner credentials
4. Check that the health endpoint returns `{ "ok": true, "version": "..." }`

## Rollback Procedure

If a deployment causes issues:

1. Go to your web service in Railway
2. Click "Deployments"
3. Find the previous working deployment
4. Click "Redeploy" on that version
5. Railway will rebuild and restart with that commit

## Cost Estimation

For one host with moderate usage:

- Web service (Hobby plan): ~$5/month base + ~$5-10 for usage
- PostgreSQL: ~$5-10/month (small database)
- Cron services: Minimal (only bill while running, seconds each)
- **Total**: ~$10-20/month

## Monitoring

- Railway provides built-in metrics (CPU, RAM, network)
- Check logs via the "Logs" tab on each service
- Health check failures will be shown in the service status

## Backup Strategy

Railway PostgreSQL includes:
- Automatic daily backups
- Point-in-time recovery
- Download backups manually from the PostgreSQL service

## Region Selection

Choose an EU region for both services (guest data lives in EU):
- Go to project settings → "Region"
- Select an EU region (e.g., Frankfurt, Amsterdam)

## Troubleshooting

### Database connection errors
- Verify `DATABASE_URL` uses Railway's variable reference
- Check PostgreSQL service is running
- Review logs for connection errors

### Cron jobs not running
- Verify cron schedule syntax
- Check the cron service has all required environment variables
- Review cron service logs

### Build failures
- Check the build command is correct
- Verify all dependencies are in `package.json`
- Review build logs for specific errors

## Development with Neon

For development and testing, you can still use Neon branches:

1. Create a free Neon project at [neon.tech](https://neon.tech)
2. Create branches for feature development
3. Use branch connection strings in local `.env`
4. Neon branches are free and perfect for isolated testing
