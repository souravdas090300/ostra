# Ostra Deployment Guide (Vercel + Neon)

## Prerequisites
- GitHub repository with the Ostra code
- Vercel account
- Neon PostgreSQL account

## Database Setup (Neon)

1. Go to [neon.tech](https://neon.tech) and sign up
2. Create a new project
3. Copy the connection string (it will look like `postgresql://user:password@ep-xxx.aws.neon.tech/neondb?sslmode=require`)
4. Keep this for the Vercel configuration

## Vercel Deployment

### 1. Import to Vercel
1. Go to [vercel.com](https://vercel.com)
2. Click "Add New Project"
3. Import your GitHub repository
4. Configure the project:
   - **Framework Preset**: Next.js
   - **Root Directory**: `./` (leave as is)
   - **Build Command**: `npm run build`
   - **Output Directory**: `.next`
   - **Install Command**: `npm install`

### 2. Environment Variables
Add the following environment variables in Vercel:

| Variable | Value | Description |
|----------|-------|-------------|
| `DATABASE_URL` | Your Neon connection string | PostgreSQL connection |
| `AUTH_SECRET` | Generate with `openssl rand -base64 32` | NextAuth secret |
| `NEXTAUTH_URL` | Your Vercel app URL (e.g., `https://ostra.vercel.app`) | Auth callback URL |
| `CRON_SECRET` | Generate with `openssl rand -base64 32` | Cron authentication |
| `APP_URL` | Your Vercel app URL | App base URL |
| `TZ` | `UTC` | Timezone for date handling |
| `ANTHROPIC_API_KEY` | (optional) Your Anthropic API key | AI features |
| `TWILIO_ACCOUNT_SID` | (optional) Your Twilio SID | WhatsApp |
| `TWILIO_AUTH_TOKEN` | (optional) Your Twilio token | WhatsApp |
| `TWILIO_WHATSAPP_FROM` | (optional) Your Twilio WhatsApp number | WhatsApp |

### 3. Build Settings
In Vercel project settings:
- **Build Command**: `npm run build`
- **Install Command**: `npm install`
- **Post-install Command**: `npx prisma generate && npx prisma migrate deploy`

### 4. Deploy
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
