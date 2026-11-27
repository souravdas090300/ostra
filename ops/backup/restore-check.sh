#!/bin/sh
# Restore check: download the newest daily dump, decrypt it, restore into a
# SCRATCH database (never production), and print sanity counts.
#
# Required env:
#   BACKUP_BUCKET         S3 bucket name
#   S3_ENDPOINT           S3-compatible endpoint URL
#   AWS_ACCESS_KEY_ID     bucket-scoped credentials
#   AWS_SECRET_ACCESS_KEY
#   AGE_IDENTITY_FILE     path to the age PRIVATE key (offline; never on Railway)
#   RESTORE_DATABASE_URL  scratch database to restore into
set -eu

: "${BACKUP_BUCKET:?BACKUP_BUCKET is required}"
: "${S3_ENDPOINT:?S3_ENDPOINT is required}"
: "${AGE_IDENTITY_FILE:?AGE_IDENTITY_FILE is required}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"

key=$(aws s3 ls "s3://$BACKUP_BUCKET/daily/" --endpoint-url "$S3_ENDPOINT" \
  | awk '{print $4}' | sort | tail -1)

if [ -z "$key" ]; then
  echo "ERROR: no backups found under s3://$BACKUP_BUCKET/daily/" >&2
  exit 1
fi

echo ">> newest backup: s3://$BACKUP_BUCKET/daily/$key"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

aws s3 cp "s3://$BACKUP_BUCKET/daily/$key" "$tmp/dump.age" --endpoint-url "$S3_ENDPOINT"
age -d -i "$AGE_IDENTITY_FILE" -o "$tmp/dump.dump" "$tmp/dump.age"

echo ">> restoring into scratch database"
pg_restore --clean --if-exists --no-owner -d "$RESTORE_DATABASE_URL" "$tmp/dump.dump"

echo ">> sanity checks"
psql "$RESTORE_DATABASE_URL" -c "
  SELECT 'owners'     AS table_name, count(*) FROM \"Owner\"
  UNION ALL SELECT 'apartments', count(*) FROM \"Apartment\"
  UNION ALL SELECT 'bookings',   count(*) FROM \"Booking\"
  UNION ALL SELECT 'messages',   count(*) FROM \"Message\";"

psql "$RESTORE_DATABASE_URL" -c \
  'SELECT max("checkIn") AS latest_checkin, max("createdAt") AS latest_booking_created FROM "Booking";'

echo ">> restore check complete"
