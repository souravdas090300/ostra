# Backup runner image: PostgreSQL client tools + age encryption + AWS CLI.
# Used by the Railway `cron-backup` service (schedule `0 1 * * *`).
FROM postgres:16-alpine

RUN apk add --no-cache age aws-cli curl

COPY backup.sh /backup.sh
RUN chmod +x /backup.sh

ENTRYPOINT ["/backup.sh"]
