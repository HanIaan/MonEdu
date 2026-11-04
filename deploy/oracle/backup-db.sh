#!/usr/bin/env bash
# Daily PostgreSQL dump to ~/monedu-backups, keeping the last 14 days.
# Restore: gunzip -c FILE.sql.gz | docker compose exec -T postgres psql -U monedu -d monedu
set -euo pipefail
cd "$(dirname "$0")"
OUT="$HOME/monedu-backups"
mkdir -p "$OUT"
FILE="$OUT/monedu-$(date -u +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T postgres pg_dump -U monedu -d monedu | gzip > "$FILE"
find "$OUT" -name 'monedu-*.sql.gz' -mtime +14 -delete
echo "$(date -u +%FT%TZ) 백업 완료: $FILE"
