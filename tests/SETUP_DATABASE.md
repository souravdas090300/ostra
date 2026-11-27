# Test database setup

The Vitest suite (`npm test`) runs against a disposable PostgreSQL database
named `*_test`. Before any test file executes, `tests/global-setup.ts`:

1. Resolves `DATABASE_URL` the same way `vitest.config.ts` does
   (`process.env.DATABASE_URL`, then `.env.test`).
2. Runs the safety guard in `lib/test-database-guard.ts` — the URL must be
   `postgres://`/`postgresql://`, the database name must end with `_test`,
   and the host must not be a known production host (or anything in
   `OSTRA_FORBIDDEN_DB_HOSTS`).
3. Runs `npx prisma migrate deploy` against that URL, so an empty database
   is migrated automatically and never causes missing-table failures.

If the guard throws, the suite refuses to run — fix `DATABASE_URL` rather
than bypassing it.

## Local setup (PowerShell)

Start the disposable Postgres container (tmpfs storage, wiped on stop):

```powershell
docker compose -f docker-compose.test.yml up -d --wait
```

`.env.test` already points at it:

```
DATABASE_URL=postgresql://ostra:ostra_test_password@127.0.0.1:5434/ostra_test
```

Then run the suite — migrations are applied automatically:

```powershell
npm test
```

To reset the database (container data is tmpfs, so restart gives a clean
slate; or drop and recreate manually):

```powershell
docker compose -f docker-compose.test.yml down
docker compose -f docker-compose.test.yml up -d --wait
```

To stop it when done:

```powershell
docker compose -f docker-compose.test.yml down
```

## CI

`.github/workflows/ci.yml` provides a Postgres service, creates the shadow
database, runs `npx prisma migrate deploy` for the drift check, and sets
`DATABASE_URL`/`SHADOW_DATABASE_URL` env vars. The global setup applies the
same migrations before tests run; CI does not need `.env.test`.

## Overriding the database

`DATABASE_URL` in the shell/CI environment wins over `.env.test`. Any
override must still satisfy the guard: `*_test` database name, Postgres
protocol, non-forbidden host.
