#!/bin/sh
# Nightly encrypted pg_dump -> S3-compatible bucket (R2/B2, EU where available).
# First day of the month an extra copy is kept under monthly/ (12-month retention
# via bucket lifecycle rules: daily/ 30 days, monthly/ 12 months).
set -eu

ts=$(date -u +%Y%m%dT%H%M%SZ)
key="daily/ostra-$ts.dump.age"

pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" \
  | age -r "$AGE_PUBLIC_KEY" \
  | aws s3 cp - "s3://$BACKUP_BUCKET/$key" --endpoint-url "$S3_ENDPOINT"

# first day of the month: keep a copy as the monthly backup
if [ "$(date -u +%d)" = "01" ]; then
  aws s3 cp "s3://$BACKUP_BUCKET/$key" "s3://$BACKUP_BUCKET/monthly/ostra-$ts.dump.age" --endpoint-url "$S3_ENDPOINT"
fi

curl -fsS "$BACKUP_PING_URL" >/dev/null || true
