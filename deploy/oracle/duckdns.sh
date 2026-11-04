#!/usr/bin/env bash
# Point DUCKDNS_SUBDOMAIN.duckdns.org at this server's current public IP (values from .env).
set -euo pipefail
cd "$(dirname "$0")"
SUB="$(grep -E '^DUCKDNS_SUBDOMAIN=' .env 2>/dev/null | cut -d= -f2-)"
TOKEN="$(grep -E '^DUCKDNS_TOKEN=' .env 2>/dev/null | cut -d= -f2-)"
if [ -z "$SUB" ] || [ -z "$TOKEN" ]; then echo "DuckDNS 값이 비어 있어 건너뜀"; exit 0; fi
RESULT="$(curl -fsS "https://www.duckdns.org/update?domains=${SUB}&token=${TOKEN}&ip=")"
echo "$(date -u +%FT%TZ) duckdns: $RESULT"
[ "$RESULT" = "OK" ]
