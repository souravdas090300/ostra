# Ostra

Guest-communication and booking-calendar tool for hosts managing several apartments (Malta).

See [OSTRA_PLAN.md](OSTRA_PLAN.md) for the build plan.

## Local Development

### Prerequisites
- Node.js 20+
- npm

### Setup
1. Install dependencies: `npm install`
2. Set up local development environment:
   ```bash
   npm run env:dev
   ```
   This copies `.env.dev` to `.env` and switches the schema to SQLite
3. Set up database:
   ```bash
   npx prisma db push
   ```
4. Seed database: `npm run seed`
5. Start dev server: `npm run dev`

### Switching Environments

**Local Development (SQLite):**
```bash
npm run env:dev
npx prisma db push
npm run seed
```

**Production (Neon PostgreSQL):**
```bash
# 1. Copy .env.prod to .env and fill in actual values
cp .env.prod .env
# 2. Edit .env to add your Neon connection strings and secrets
# 3. Switch schema to PostgreSQL
npm run env:prod
# 4. Run migrations
npx prisma db push
```

### Scripts
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run typecheck` - Run TypeScript type checking
- `npm run test` - Run tests
- `npm run seed` - Seed database with sample data

## Deployment (Railway)

This project is configured for deployment on Railway with PostgreSQL.

### Steps
1. Push code to GitHub
2. Create a Railway project:
   - Go to [railway.app](https://railway.app) and create an account
   - Import your GitHub repository
3. Add PostgreSQL service:
   - Click "New Service" → "Database" → "PostgreSQL"
   - Railway will create and configure the database
4. Add web service:
   - Click "New Service" → "GitHub Repo" → select your repository
   - Configure build and start:
     - Build Command: `npm run build`
     - Start Command: `npx prisma migrate deploy && npm run start`
5. Configure environment variables on the web service:
   - `DATABASE_URL` (reference the PostgreSQL service using the Railway variable button)
   - `AUTH_SECRET` (generate with `openssl rand -base64 32`)
   - `CRON_SECRET` (generate with `openssl rand -base64 32`)
   - `APP_URL` (the public Railway URL of your web service)
   - `AUTH_TRUST_HOST=true` (needed behind Railway's proxy)
   - `TZ=UTC` (required for consistent date handling)
   - `ANTHROPIC_API_KEY` (if using AI features)
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` (if using WhatsApp)
   - Additional variables from `.env.example` as needed
6. Add cron services:
   - Create new services from GitHub for each cron job
   - Set them to run as scripts using the same repository
   - Configure cron schedules in Railway's UI
7. Set up health check:
   - Health check path: `/api/health`
   - Railway uses this to monitor service health

### Cron Jobs
Railway Cron Services:
- Calendar sync: Every 30 minutes
- Scheduled messages: Every 10 minutes
- Template sync: Every hour
- Retention cleanup: Daily
- Self-check: Every 5 minutes

### Note
- Local development uses SQLite for simplicity
- Production uses PostgreSQL on Railway
- Neon can still be used for development/test branches
- Deploy from the `main` branch
- For rollback: redeploy a previous deployment from Railway's deployments tab
