# Ostra Phase 1: Foundation, authentication, deployment

> **For Devin:** read `OSTRA_PLAN.md` (Phase 1), `schema.prisma` (the initial schema in the repository root) and this file. This file **replaces** Phase 1 in the plan where they differ and contains the exact contracts that every later phase relies on. Complete **Phase 1 only**, in one PR, and meet every acceptance criterion in section 12.

## 0. Contracts later phases depend on (do not change these names or shapes)

| Contract | Used by |
|---|---|
| `import { prisma } from "@/lib/db"` | everything |
| `requireOwner(): Promise<Owner-without-passwordHash>`, redirects to `/login` when there is no valid session; returns the full owner row, so fields added later (`hostLanguage`, `defaultGuestLanguage`, ...) appear automatically | every page, action and route that needs a session |
| `cronAuthorized(req)` in `src/lib/cron-auth.ts` | all cron routes |
| Middleware lets these paths through without a session: `/login`, `/privacy`, `/api/auth/*`, `/api/health*`, `/api/cron/*`, `/api/webhooks/*`, `/api/ical/*`, `/monitoring` | Phases 3, 6, 7, 9, 11 |
| Path alias `@/` maps to `src/` | everything |
| Scripts `lint`, `typecheck`, `test`, `build`, `db:migrate`, `db:seed` | CI and every phase |
| Environment variables from section 2 | everything |

## 1. Setup commands

```bash
npx create-next-app@latest ostra --ts --tailwind --app --src-dir --eslint --import-alias "@/*"
cd ostra
npm i @prisma/client next-auth@beta bcryptjs zod date-fns date-fns-tz
npm i -D prisma tsx vitest @vitejs/plugin-react cross-env @types/bcryptjs prettier eslint-config-prettier
npx prisma init --datasource-provider postgresql
```
Use **Node 20 or newer** (`"engines": { "node": ">=20" }` and a `.nvmrc`). Next.js 15, React 19, Auth.js v5 (the `next-auth@beta` line), Prisma 6.

`package.json` scripts:
```json
{
  "dev": "cross-env TZ=UTC next dev",
  "build": "prisma generate && next build",
  "start": "next start",
  "lint": "next lint",
  "typecheck": "tsc --noEmit",
  "test": "cross-env TZ=UTC vitest run",
  "db:migrate": "prisma migrate dev",
  "db:deploy": "prisma migrate deploy",
  "db:seed": "tsx prisma/seed.ts",
  "format": "prettier --write ."
}
```
Prisma config in `package.json`: `"prisma": { "seed": "tsx prisma/seed.ts" }`. TypeScript strict mode on (`"strict": true`, `"noUncheckedIndexedAccess": false`).

## 2. Environment: `.env.example` (commit this file; never commit `.env`)

```
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ostra
DATABASE_URL_TEST=postgresql://postgres:postgres@localhost:5432/ostra_test

# App
APP_URL=http://localhost:3000
AUTH_SECRET=                       # openssl rand -base64 32
AUTH_TRUST_HOST=true               # needed behind Railway's proxy
CRON_SECRET=                       # openssl rand -base64 32
TZ=UTC

# Seed (development and first production owner only)
SEED_OWNER_EMAIL=host@example.com
SEED_OWNER_PASSWORD=               # at least 12 characters

# Added by later phases (leave empty until then): ANTHROPIC_API_KEY, ANTHROPIC_MODEL,
# TWILIO_*, WHATSAPP_MODE, DATA_PEPPER, SENTRY_DSN, OPERATOR_EMAIL, RESEND_API_KEY ...
```
Add a startup check `src/lib/env.ts` using zod that validates the **required** variables for the current phase (`DATABASE_URL`, `AUTH_SECRET`, `APP_URL`, `CRON_SECRET`) and throws a clear error naming the missing variable (never printing values). Import it from `src/lib/db.ts` and `src/lib/auth.ts`. Later phases add their own required variables to the same schema.

## 3. Database

`prisma/schema.prisma` = the provided `schema.prisma` plus, in `Owner`: `passwordHash String`. Create the first migration:
```bash
npx prisma migrate dev --name init
```
Commit the `prisma/migrations` folder. Never edit an applied migration; every change is a new migration. In production the app runs `prisma migrate deploy` before starting.

`src/lib/db.ts`
```ts
import { PrismaClient } from "@prisma/client";
import "./env";

const g = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  g.prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });

if (process.env.NODE_ENV !== "production") g.prisma = prisma;
```
(Do not log queries in production: they contain personal data.)

## 4. Authentication (Auth.js v5, credentials, JWT sessions)

`src/lib/auth.config.ts` (edge-safe: no database, no bcrypt)
```ts
import type { NextAuthConfig } from "next-auth";

const PUBLIC = [/^\/login$/, /^\/privacy$/, /^\/api\/auth\//, /^\/api\/health/, /^\/api\/cron\//,
  /^\/api\/webhooks\//, /^\/api\/ical\//, /^\/monitoring/, /^\/_next\//, /^\/favicon/];

export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 14 * 24 * 60 * 60 },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname;
      if (PUBLIC.some((re) => re.test(path))) return true;
      return !!auth?.user;                 // everything else needs a session
    },
  },
} satisfies NextAuthConfig;
```

`src/lib/auth.ts`
```ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { redirect } from "next/navigation";
import { authConfig } from "./auth.config";
import { prisma } from "./db";

// Compared against when the email is unknown, so timing does not reveal which emails exist.
const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEeO5f2hQK8m1k6uQe1gQ1qk2c5e1o9o9Xq";

const credentialsSchema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const email = parsed.data.email.trim().toLowerCase();
        const owner = await prisma.owner.findUnique({ where: { email } });
        const ok = await bcrypt.compare(parsed.data.password, owner?.passwordHash ?? DUMMY_HASH);
        if (!owner || !ok) return null;
        return { id: owner.id, email: owner.email, name: owner.name ?? undefined };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    jwt({ token, user }) {
      if (user) token.ownerId = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.ownerId) session.user.id = token.ownerId as string;
      return session;
    },
  },
});

export type SessionOwner = Omit<NonNullable<Awaited<ReturnType<typeof prisma.owner.findUnique>>>, "passwordHash">;

/** The logged-in owner, or a redirect to /login. Use in every page, server action and route that needs a session. */
export async function requireOwner(): Promise<SessionOwner> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect("/login");
  const owner = await prisma.owner.findUnique({ where: { id } });
  if (!owner) redirect("/login");
  const { passwordHash: _omit, ...safe } = owner;
  return safe;
}
```
Generate a real bcrypt hash for `DUMMY_HASH` (cost 12) instead of the placeholder string above, and add a test that `bcrypt.compare("x", DUMMY_HASH)` runs (returns false) without throwing.

Add TypeScript module augmentation (`src/types/next-auth.d.ts`) so `session.user.id` is typed.

`src/app/api/auth/[...nextauth]/route.ts`: `export const { GET, POST } = handlers;` (import `handlers` from `@/lib/auth`).

`src/middleware.ts`
```ts
import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

export default NextAuth(authConfig).auth;

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
```
Defence in depth: middleware is **not** the only protection. `(app)/layout.tsx` and every server action and data route call `requireOwner()` themselves.

## 5. Pages

**`src/app/(auth)/login/page.tsx`** (server component) plus a client `LoginForm` using a server action:
```ts
// actions: src/app/(auth)/login/actions.ts
"use server";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";

export async function login(_prev: { error?: string } | undefined, fd: FormData) {
  try {
    await signIn("credentials", { email: fd.get("email"), password: fd.get("password"), redirectTo: "/calendar" });
  } catch (e) {
    if (e instanceof AuthError) return { error: "Email or password is wrong." }; // one generic message
    throw e;                                                                       // lets the redirect through
  }
}
```
The form: email, password, a **Sign in** button disabled while pending, `autoComplete` attributes (`username`, `current-password`), the generic error shown below. No registration page (one host for now; the owner is created by the seed or by `scripts/set-password.ts` in Phase 9).

**`src/app/(app)/layout.tsx`** (server): `const owner = await requireOwner();` then render a header with the product name, the navigation, the owner's email and a **Sign out** form action (`signOut({ redirectTo: "/login" })`). Navigation items for now: **Calendar** (`/calendar`), **Apartments** (`/apartments`); later phases add Inbox, Leads, Settings. Mobile first: a top bar with a menu button below 640 px, links as large tap targets (at least 44 px). Include `<meta name="viewport">` defaults from Next, set `lang="en"` on `<html>`, and a global `max-w` container.

**Placeholder pages** so navigation works and acceptance tests can run: `/calendar` ("Calendar coming in Phase 4") and `/apartments` ("Apartments coming in Phase 2"), both server components calling `requireOwner()` (the layout already does, keep the call anyway). `src/app/page.tsx` redirects to `/calendar`. A `not-found.tsx` and an `error.tsx` with a friendly message and no technical details.

**`GET /api/health`** (public): runs `SELECT 1` with a 2-second timeout and returns `{ ok: true, version: process.env.RAILWAY_GIT_COMMIT_SHA ?? "dev" }` or `{ ok: false }` with status 503. (Phase 9 hardens it; the Railway health check uses it from the start.)

**`src/lib/cron-auth.ts`**
```ts
import { timingSafeEqual } from "node:crypto";

export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;                       // fail closed
  const a = Buffer.from(req.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

## 6. Seed: `prisma/seed.ts`

Idempotent: safe to run again in development; **refuses to run when `NODE_ENV=production` unless `--allow-production` is passed** and then only creates the owner (no demo data).
```ts
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_OWNER_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_OWNER_PASSWORD;
  if (!email || !password || password.length < 12) throw new Error("Set SEED_OWNER_EMAIL and a SEED_OWNER_PASSWORD of at least 12 characters.");
  const production = process.env.NODE_ENV === "production";
  if (production && !process.argv.includes("--allow-production")) throw new Error("Refusing to seed production without --allow-production.");

  const owner = await prisma.owner.upsert({
    where: { email },
    update: {},                                           // never overwrite an existing password
    create: { email, name: "Host", passwordHash: await bcrypt.hash(password, 12) },
  });
  if (production) return;

  // Development demo data: three apartments with starter text.
  const names = ["Sliema Seaview", "Valletta Courtyard", "Gozo Farmhouse"];
  for (const name of names) {
    const exists = await prisma.apartment.findFirst({ where: { ownerId: owner.id, name } });
    if (!exists) {
      await prisma.apartment.create({ data: { ownerId: owner.id, name, address: `${name}, Malta`, info: "" } });
    }
  }
}

main().finally(() => prisma.$disconnect());
```
Later phases extend this file with their own scenarios (Phase 4 bookings and conflicts, Phase 6 templates, E3 rates and leads); keep the production guard.

## 7. Quality tooling
- ESLint: Next's config plus `eslint-config-prettier`; rules `no-unused-vars` (error, ignoring `_`-prefixed), `@typescript-eslint/no-explicit-any` (warn). Phase 9 adds `no-console`.
- Prettier config: `{ "singleQuote": false, "printWidth": 110, "trailingComma": "all" }`.
- `vitest.config.ts`: alias `@` to `src`, `environment: "node"`, `include: ["tests/**/*.test.ts"]`, `globalSetup` that applies migrations to `DATABASE_URL_TEST` (run `prisma migrate deploy` with that URL) and a `setupFiles` helper `tests/helpers/db.ts` exporting `resetDb()` (truncate all tables in dependency order) and factory functions `makeOwner()`, `makeApartment(ownerId)` used by every later phase's tests. Tests that need the database call `resetDb()` in `beforeEach`.
- `.gitignore` includes `.env`, `.env.*.local`, `.next`, `node_modules`, `coverage`, `playwright-report`.
- `README.md`: what Ostra is, local setup (`cp .env.example .env`, `docker run` for Postgres, `npm i`, `npm run db:migrate`, `npm run db:seed`, `npm run dev`), scripts, how to run tests, folder map, and links to every `OSTRA_*.md` plan.

## 8. CI: `.github/workflows/ci.yml`
```yaml
name: ci
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: postgres, POSTGRES_DB: ostra_test }
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres" --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      TZ: UTC
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/ostra_test
      DATABASE_URL_TEST: postgresql://postgres:postgres@localhost:5432/ostra_test
      AUTH_SECRET: ci-secret-ci-secret-ci-secret-ci-secret
      APP_URL: http://localhost:3000
      CRON_SECRET: ci-cron-secret
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx prisma validate
      - run: npx prisma migrate deploy
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```
Branch protection (document in the README): require the `check` job before merging.

## 9. Deployment on Railway
1. Create a Railway project with a **PostgreSQL** service and a **web** service from the GitHub repository (deploy from `main`).
2. Web service: build command `npm run build`; start command `npx prisma migrate deploy && npm run start`; health check path `/api/health`; variables `DATABASE_URL` (reference the Postgres service's private URL), `AUTH_SECRET`, `AUTH_TRUST_HOST=true`, `APP_URL` (the public https URL), `CRON_SECRET`, `TZ=UTC`, `NODE_ENV=production`.
3. Set a custom domain later; until then use the Railway domain and put it in `APP_URL` (the Twilio signature and calendar links depend on it being exact, without a trailing slash).
4. Create the first owner once: run the seed in the Railway shell with `SEED_OWNER_EMAIL`, `SEED_OWNER_PASSWORD` and `npx tsx prisma/seed.ts --allow-production`, then **remove** the password variable.
5. Document all of this, plus how to roll back (redeploy the previous deployment), in `docs/DEPLOY.md`. Cron services arrive in Phase 3.
6. Railway regions: choose an **EU region** for both services (guest data lives here).

## 10. Tests

**Unit and database tests**
- `requireOwner`: with no session it redirects to `/login` (mock `auth` and `next/navigation`); with a session for a deleted owner it redirects; with a valid session it returns the owner **without** `passwordHash`.
- `authorize` (extract the check into `verifyCredentials(email, password)` so it is testable): wrong password, unknown email and malformed input all return `null`; email matching is case-insensitive and trimmed; the unknown-email path still calls `bcrypt.compare` (spy); a correct password returns the owner id.
- `authConfig.authorized`: public paths (`/login`, `/privacy`, `/api/health`, `/api/cron/x`, `/api/webhooks/twilio`, `/api/ical/abc.ics`, `/monitoring`) pass without a session; `/calendar`, `/apartments`, `/settings`, `/api/export/guest` and `/` need one.
- `cronAuthorized`: right secret, wrong secret, missing header, unset `CRON_SECRET`, different lengths (no exception).
- `/api/health`: 200 with the database up, 503 when the query fails (mock Prisma).
- Seed: creates the owner and three apartments; running twice creates no duplicates and does not change the password; refuses `production` without the flag; rejects a short password.
- Env check: throws naming the missing variable, never prints the value.
- Test helpers: `resetDb()` empties every table; `makeOwner()` and `makeApartment()` create valid rows.

**Manual checks**
1. Logged out, open `/calendar` and `/apartments`: redirected to `/login`; `/api/health` works; `/privacy` returns 404 for now (it arrives in Phase 9).
2. Wrong password shows the one generic message; correct password lands on `/calendar`; sign out returns to `/login`; the session survives a reload.
3. 390 px viewport: header and navigation usable, nothing scrolls sideways.
4. A deployed production URL loads over https, migrations ran, the health check is green, and the first owner can sign in.

## 11. Not in this phase
Registration, password reset, password change and login lockout (Phase 9), the privacy page (Phase 9), the calendar and apartments features (Phases 2 to 4), and any WhatsApp, AI or cron features.

## 12. Acceptance criteria
- Logged-out visitors cannot reach any page except `/login`, `/privacy` (404 for now), `/api/health` and the other public paths listed in section 0; middleware, layout and every server function each enforce this.
- The seeded owner can sign in and out; failures show one generic message; sessions last at most 14 days.
- The contracts in section 0 exist exactly as specified, including the `@/` alias, `requireOwner`, `cronAuthorized`, the test helpers and the scripts.
- `prisma migrate deploy` applies cleanly on a fresh database; the seed is idempotent and production-safe.
- CI runs `prisma validate`, migrations, lint, typecheck, tests and build on every push and passes.
- The app is deployed on Railway in an EU region with a health check, `APP_URL` correct, and `docs/DEPLOY.md` describing deploy, rollback and first-owner creation.
- No secrets are committed; `.env.example` documents every variable used so far.
