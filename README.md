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

## Deployment (Vercel + Neon)

This project is configured for deployment on Vercel with Neon PostgreSQL.

### Steps
1. Push code to GitHub
2. Create a Neon PostgreSQL database:
   - Go to [neon.tech](https://neon.tech) and create a free account
   - Create a new project and copy the connection string
3. Deploy to Vercel:
   - Go to [vercel.com](https://vercel.com) and import your GitHub repository
   - Configure environment variables in Vercel:
     - `DATABASE_URL` (from Neon)
     - `AUTH_SECRET` (generate with `openssl rand -base64 32`)
     - `NEXTAUTH_URL` (your Vercel app URL)
     - `ANTHROPIC_API_KEY` (if using AI features)
     - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` (if using WhatsApp)
     - `CRON_SECRET` (generate with `openssl rand -base64 32`)
     - `APP_URL` (your Vercel app URL)
4. Add a build step in Vercel settings:
   - Build Command: `npm run build`
   - Install Command: `npm install`
   - Post-install Command: `npx prisma generate && npx prisma migrate deploy`

### Note
- Local development uses SQLite for simplicity
- Production uses PostgreSQL on Neon
- The schema supports both databases
