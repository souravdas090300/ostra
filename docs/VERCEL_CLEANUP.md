# Vercel Migration Guide

**NOTE**: This project now uses Railway for production deployment. The Vercel configuration should be removed.

## Files to Remove

1. **vercel.json** - Vercel cron job configuration (no longer needed)
   - Delete this file: `rm vercel.json` (Unix) or delete in file explorer (Windows)

2. **.vercelignore** - If present, delete it

## Environment Variables to Remove

If you previously had Vercel-specific variables in `.env` or Railway:

- `NEXTAUTH_URL` - Not needed with Railway (use `APP_URL` instead)
- `VERCEL_URL` - Not needed

## Cron Jobs Migration

Vercel cron jobs were configured in `vercel.json`. With Railway, cron jobs are configured as separate services:

- Each cron is a Railway service with its own start command
- Schedules are set in Railway's UI
- See `docs/DEPLOY.md` for Railway cron setup

## Next Steps

1. Delete `vercel.json`
2. Deploy to Railway following `docs/DEPLOY.md`
3. Configure cron services in Railway
4. Remove any Vercel-specific environment variables
