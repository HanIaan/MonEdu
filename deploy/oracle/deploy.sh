#!/usr/bin/env bash
# Pull the latest code and (re)start everything. Safe to run again any time.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo ".env 가 없습니다. cp .env.example .env 후 값을 채워 주세요."; exit 1; }

git -C ../.. pull --ff-only
docker compose up -d --build --remove-orphans
docker image prune -f >/dev/null

echo "==> 상태"
docker compose ps
DOMAIN="$(grep -E '^DOMAIN=' .env | cut -d= -f2-)"
echo "접속 주소: https://$DOMAIN  (처음엔 HTTPS 인증서 발급에 1~2분 걸릴 수 있어요)"
