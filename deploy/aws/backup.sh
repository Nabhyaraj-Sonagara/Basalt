#!/usr/bin/env sh
# Nightly backup: dumps the database (and, with disk storage, the encrypted blobs) to S3.
# Everything in the dump is already encrypted by the apps except emails and sizes.
# Install: crontab -e, then add:  15 3 * * * cd /opt/basalt && ./backup.sh >> backup.log 2>&1
set -eu
cd "$(dirname "$0")"
. ./.env
: "${BACKUP_S3_URI:?Set BACKUP_S3_URI in .env}"
stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

docker compose exec -T db pg_dump -U basalt -d basalt --format=custom > "$tmp/basalt-$stamp.dump"
aws s3 cp "$tmp/basalt-$stamp.dump" "$BACKUP_S3_URI/db/basalt-$stamp.dump" --only-show-errors

if [ -z "${S3_BUCKET:-}" ]; then
  docker run --rm -v basalt_blobs:/data:ro -v "$tmp":/out alpine tar czf "/out/blobs-$stamp.tgz" -C /data .
  aws s3 cp "$tmp/blobs-$stamp.tgz" "$BACKUP_S3_URI/blobs/blobs-$stamp.tgz" --only-show-errors
fi
echo "Backed up $stamp"
