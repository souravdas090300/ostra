# Ostra Deployment Guide

**DEPRECATED**: This document is for Vercel + Neon deployment, which is no longer the recommended approach.

**Current deployment target**: Railway

Please use **[DEPLOY.md](./DEPLOY.md)** for Railway deployment instructions.

## Why the Change?

Railway was chosen over Vercel + Neon because:
- **Lower cost**: $10-20/month vs $30-45/month for one host
- **Simpler architecture**: One platform for web app, database, and cron jobs
- **Normal PostgreSQL**: Always-on database as the code assumes
- **Built-in cron**: Simpler cron job management
- **Automatic backups**: Included in Railway's PostgreSQL service

## Vercel + Neon Documentation (Archived)

If you still need to deploy on Vercel + Neon for any reason, the following sections are preserved for reference.
Click "Deploy". Vercel will:
1. Install dependencies
2. Generate Prisma client
3. Run database migrations
4. Build the Next.js app
5. Deploy to Vercel's edge network

## Cron Jobs

The project uses Vercel Cron Jobs configured in `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/sync-calendars",
      "schedule": "*/30 * * * *"
    },
    {
      "path": "/api/cron/send-scheduled",
      "schedule": "*/10 * * * *"
    }
  ]
}
```

- **Calendar sync**: Runs every 30 minutes to sync iCal feeds
- **Scheduled messages**: Runs every 10 minutes to send scheduled WhatsApp messages

Note: Vercel Cron Jobs are only available on Pro plans and above. For Hobby plans, you can use GitHub Actions or external cron services.

## Database Seeding

To seed the production database with initial data:

1. Access your Neon database via the Neon console
2. Run the seed script locally connected to production:
   ```bash
   DATABASE_URL="your-production-url" npm run seed
   ```

## Monitoring

- Check Vercel dashboard for deployment logs
- Monitor cron job execution in Vercel's cron logs
- Use Neon's dashboard to monitor database performance
- Check feed sync status in the Ostra UI (Apartments page)

## Troubleshooting

### Cron Jobs Not Running
- Ensure you're on a Vercel Pro plan (Hobby doesn't support cron)
- Check `vercel.json` is included in your deployment
- Verify `CRON_SECRET` is set correctly

### Database Connection Issues
- Verify `DATABASE_URL` is correct
- Check Neon database is active (not paused)
- Ensure SSL is enabled in the connection string

### Sync Failures
- Check feed URLs are accessible (test locally first)
- Verify `TZ=UTC` is set in environment variables
- Check Vercel function logs for error messages

### Timezone Issues
- Ensure `TZ=UTC` is set in Vercel environment variables
- Check date conversions are working correctly in tests
