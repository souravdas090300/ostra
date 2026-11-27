# Backups and restore

Nightly encrypted `pg_dump` uploads to a private S3-compatible bucket, plus a
rehearsed restore procedure. Spec: `docs/spec/OSTRA_PHASE9_HARDENING.md` §7.

## Components

| File | Purpose |
|---|---|
| `Dockerfile` | `postgres:16-alpine` + `age` + AWS CLI + `curl`; entrypoint is `backup.sh` |
| `backup.sh` | dumps `DATABASE_URL` → `age` encrypt → `aws s3 cp` to `daily/`; on the 1st of the month also copies to `monthly/`; pings `BACKUP_PING_URL` |
| `restore-check.sh` | downloads newest `daily/` dump, decrypts locally, `pg_restore`s into a scratch DB, prints sanity counts |

## Railway `cron-backup` service

- Schedule: `0 1 * * *` (01:00 UTC, ~02:00–03:00 Malta time)
- Build from `ops/backup/Dockerfile`
- Environment variables:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | private/internal Postgres URL |
| `AGE_PUBLIC_KEY` | public key only — the private key stays offline |
| `BACKUP_BUCKET` | bucket name |
| `S3_ENDPOINT` | e.g. `https://<account>.r2.cloudflarestorage.com` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | credentials scoped to this bucket only |
| `BACKUP_PING_URL` | healthchecks.io-style heartbeat URL |

## Storage requirements

- S3-compatible bucket (Cloudflare R2 or Backblaze B2) **in the EU where available**
- Private; lifecycle rules: delete `daily/` after 30 days, `monthly/` after 12 months
- The **age private key stays offline** (password manager + printed copy) — never on
  Railway, never in the repo. Generate a keypair with `age-keygen`.

## Rehearsal

Run `restore-check.sh` against a scratch database **before launch and every
quarter**, then record date, backup used, time taken, and checks in
`docs/RESTORE_LOG.md`.

## Restoring production

1. **Maintenance mode**: `ASSISTANT_ENABLED=false`,
   `AUTOMATIC_MESSAGES_ENABLED=false`, scale the web service to zero.
2. Restore the chosen dump into the production database with `pg_restore`
   (decrypt first with the offline age private key).
3. **Run the retention job before reopening** so previously deleted data does not
   return, and re-apply the opt-out list from the restored data.
4. Run `prisma migrate deploy`.
5. Reopen and watch `/settings/status`.

**Recovery targets:** at most one day of data lost (nightly dumps); restore time
is whatever the last rehearsal measured — record it in `docs/RESTORE_LOG.md`.
