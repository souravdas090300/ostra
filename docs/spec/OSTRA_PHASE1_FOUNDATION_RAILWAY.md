# Ostra Phase 1: Foundation, login and deployment on Railway

> **For Devin:** this replaces Phase 1 in `OSTRA_PLAN.md` (which assumed Vercel). Complete **Phase 1 only**, in one PR, and meet every acceptance criterion in section 9. Read `OSTRA_MASTER_GUIDE.md` and its `AGENTS.md` first.

## 1. Bootstrap
```bash
npx create-next-app@latest ostra --ts --tailwind --eslint --app --src-dir --import-alias "@/*"
cd ostra
npm i @prisma/client next-auth@beta bcryptjs zod date-fns date-fns-tz
npm i -D prisma vitest @vitest/coverage-v8 cross-env tsx prettier @types/bcryptjs
npx prisma init --datasource-provider postgresql
```
`package.json` scripts:
```json
{
  "dev": "cross-env TZ=UTC next dev",
  "build": "prisma generate && next build",
  "start": "next start",
  "lint": "next lint",
  "typecheck": "tsc --noEmit",
  "test": "cross-env TZ=UTC vitest run",
  "format": "prettier --write .",
  "db:migrate": "prisma migrate dev",
  "db:deploy": "prisma migrate deploy",
  "db:seed": "tsx prisma/seed.ts"
}
```
Add `"prisma": { "seed": "tsx prisma/seed.ts" }`. `tsconfig` strict (`"strict": true`, `"noUncheckedIndexedAccess": false`). Pin Node 22 in `.nvmrc` and `engines`. Add Prettier config and a `.gitignore` that excludes `.env*` except `.env.example`.

## 2. Database
- Copy `schema.prisma` (the file delivered earlier) to `prisma/schema.prisma`. Add to `Owner`: `passwordHash String`, `hostLanguage String @default("en")`, `defaultGuestLanguage String @default("en")`, `name String?` (the language fields are also added in Phase 2's migration; if they already exist here, skip them there).
- First migration: `npx prisma migrate dev --name init`. Later phases add migrations named in their documents; never edit an applied migration.
- `src/lib/db.ts`:
```ts
import { PrismaClient } from "@prisma/client";
const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.prisma = prisma;
```

## 3. Authentication (Auth.js v5, credentials, JWT sessions)
Middleware runs on the edge and cannot use Prisma, so the configuration is split.

`src/auth.config.ts`
```ts
import type { NextAuthConfig } from "next-auth";

// Anything not listed here requires a session. These routes authenticate themselves (signature, secret or token).
export const PUBLIC_PREFIXES = [
  "/login", "/privacy", "/api/auth", "/api/health", "/api/cron", "/api/webhooks", "/api/ical", "/monitoring",
];

export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 14 * 24 * 60 * 60 },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname;
      if (PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return true;
      return !!auth?.user;
    },
    jwt({ token, user }) { if (user?.id) token.ownerId = user.id; return token; },
    session({ session, token }) { if (token.ownerId) session.user.id = token.ownerId as string; return session; },
  },
} satisfies NextAuthConfig;
```
`src/middleware.ts`
```ts
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
export default NextAuth(authConfig).auth;
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"] };
```
`src/auth.ts`
```ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { prisma } from "@/lib/db";

const schema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });
// A real bcrypt hash (cost 12) of a random string, generated once with bcryptjs and pasted here.
// It makes the response time the same whether or not the email exists.
const DUMMY_HASH = "<generate once: bcrypt.hashSync(randomBytes(16).toString('hex'), 12)>";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const p = schema.safeParse(raw);
        if (!p.success) return null;
        const owner = await prisma.owner.findUnique({ where: { email: p.data.email.trim().toLowerCase() } });
        const ok = await bcrypt.compare(p.data.password, owner?.passwordHash ?? DUMMY_HASH);
        if (!owner || !ok) return null;
        return { id: owner.id, email: owner.email, name: owner.name ?? undefined };
      },
    }),
  ],
});
```
`src/app/api/auth/[...nextauth]/route.ts`: `export const { GET, POST } = handlers;` (import from `@/auth`).

`src/types/next-auth.d.ts`: augment `Session["user"]` with `id: string`.

`src/lib/auth.ts`
```ts
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "./db";

/** Every server component, page and action behind the login calls this first. */
export async function requireOwner() {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect("/login");
  const owner = await prisma.owner.findUnique({ where: { id } });
  if (!owner) redirect("/login");
  return owner;
}
```
Phase 9 later adds login lockout, session invalidation after a password change, and the rate limiter inside `authorize`.

## 4. Pages
- `src/app/login/page.tsx`: a server component with a form whose server action calls `signIn("credentials", { email, password, redirectTo: "/calendar" })`; catch `AuthError` and redirect back with `?error=1`; show one generic message ("Email or password is wrong."). Autofocus the email field, `autoComplete` attributes set, large touch targets, no password hints.
- `src/app/(app)/layout.tsx`: calls `requireOwner()`, renders a top bar with the product name, links **Calendar, Apartments, Inbox, Settings** (placeholders for pages that do not exist yet may render "Coming soon") and a sign-out form (`signOut({ redirectTo: "/login" })`). Mobile first: nav scrolls horizontally, nothing overflows at 390 px.
- `src/app/(app)/calendar/page.tsx`: placeholder "Calendar" heading (Phase 4 replaces it). `src/app/page.tsx` redirects to `/calendar`.
- `src/app/api/health/route.ts`: `GET` runs `SELECT 1` with a 2-second timeout, returns `{ ok: true, version: process.env.RAILWAY_GIT_COMMIT_SHA ?? "dev" }` or 503 `{ ok: false }`; no other data.
- Global `error.tsx` and `not-found.tsx` with friendly text and no stack traces.

## 5. Seed: `prisma/seed.ts`
Idempotent (upserts). Reads `SEED_OWNER_EMAIL` and `SEED_OWNER_PASSWORD` from the environment (refuse to run in production unless `SEED_ALLOW_PRODUCTION=1`), hashes with bcrypt cost 12, creates one owner, three apartments (names like "Sliema Seaview", "Valletta Loft", "Gozo Farmhouse", check-in 15:00, check-out 11:00), and two sample direct bookings per apartment. Later phases extend it.

## 6. Environment: `.env.example` (complete list, grows with later phases)
```
DATABASE_URL=postgresql://user:pass@localhost:5432/ostra
AUTH_SECRET=                      # openssl rand -base64 32
AUTH_TRUST_HOST=true              # required behind Railway's proxy
APP_URL=http://localhost:3000     # public https URL in production, no trailing slash
TZ=UTC
CRON_SECRET=                      # openssl rand -base64 32
SEED_OWNER_EMAIL=
SEED_OWNER_PASSWORD=
```
The full variable list for all phases is in `OSTRA_MASTER_GUIDE.md`.

## 7. Continuous integration: `.github/workflows/ci.yml`
```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: postgres, POSTGRES_DB: ostra_test }
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres" --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/ostra_test
      AUTH_SECRET: ci-secret-not-for-production
      APP_URL: http://localhost:3000
      TZ: UTC
      WHATSAPP_MODE: dry-run
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - run: npx prisma generate
      - run: npx prisma migrate deploy
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```
Phase 9 adds `npm audit`, secret scanning, schema drift and end-to-end jobs.

## 8. Deploying to Railway (document the same steps in `docs/RUNBOOK.md`)
1. Create a Railway project; add the **PostgreSQL** plugin (choose an EU region if available).
2. Add a service from the GitHub repository (the web service). Set variables: `DATABASE_URL` (reference the Postgres service's private URL), `AUTH_SECRET`, `AUTH_TRUST_HOST=true`, `APP_URL` (the generated public domain, https), `TZ=UTC`, `CRON_SECRET`, `NODE_ENV=production`.
3. `railway.json` in the repo root (check field names against Railway's current config-as-code documentation):
```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": { "builder": "NIXPACKS" },
  "deploy": {
    "startCommand": "npx prisma migrate deploy && npm run start",
    "healthcheckPath": "/api/health",
    "restartPolicyType": "ON_FAILURE"
  }
}
```
Run **one** web replica (migrations run at start; concurrent replicas would race).
4. Create the owner once: run the seed with `SEED_ALLOW_PRODUCTION=1` and a strong `SEED_OWNER_PASSWORD` from a one-off shell, then remove those variables. (Phase 9 adds `scripts/set-password.ts` for later changes.)
5. Open the public URL: `/login` loads, `/calendar` redirects to `/login` when logged out, `/api/health` returns 200.
6. Cron services come in later phases (calendar sync, message sending, and so on); the full table is in the master guide.

## 9. Tests and acceptance
**Unit and database tests**
- Middleware logic (`authorized`): every public prefix passes without a session, `/calendar`, `/apartments`, `/api/export/x` and `/anything-else` require one; a path that merely starts with the same letters (`/loginx`, `/api/cronx`) is **not** public.
- `authorize`: correct credentials succeed (case-insensitive email), wrong password, unknown email and malformed input all return `null`; a bcrypt comparison always runs (spy that `bcrypt.compare` is called for unknown emails too).
- `requireOwner` redirects to `/login` without a session or when the owner no longer exists, and returns the owner otherwise.
- `/api/health` returns 200 with a working database and 503 when the query fails.
- Seed: runs twice without duplicates, refuses production without the override.
- Add the first **owner-scoping test pattern** (two owners, one query helper) so later phases copy it.

**Acceptance criteria**
- Visiting any page except the public ones logged out redirects to `/login`; the seeded owner can log in and out; the 14-day session expires as configured.
- Wrong credentials show one generic message; no stack trace or secret is ever shown.
- CI passes (lint, typecheck, tests, build) and the migration applies on a fresh database.
- The app is deployed on Railway with Postgres, the health check passes, and `docs/RUNBOOK.md` lists the deployment steps and variables.
- Everything is usable at 390 px width.
