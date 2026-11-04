#!/usr/bin/env bash
# Starts Postgres (compose) + Spring Boot for E2E. Secrets are generated per run, never committed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
docker compose -f "$ROOT/infra/docker-compose.yml" up -d --wait postgres
export JAVA_HOME="${JAVA_HOME_21:-$(/usr/libexec/java_home -v 21)}"
export DB_URL="jdbc:postgresql://localhost:${POSTGRES_PORT:-5433}/study_monitor"
export DB_USERNAME=study_monitor DB_PASSWORD=study_monitor
export JWT_SECRET="${JWT_SECRET:-$(openssl rand -base64 48)}"
export SEED_DEMO_DATA=true FLYWAY_LOCATIONS=classpath:db/migration,classpath:db/seed
export CORS_ALLOWED_ORIGINS=http://localhost:3000
# v1.3 accounts: E2E traffic all comes from 127.0.0.1 → raise the per-IP limits; plain-http cookies.
export AUTH_IP_LIMIT_PER_MINUTE=100000 REFRESH_IP_LIMIT_PER_MINUTE=100000 AUTH_COOKIE_SECURE=false
export FRONTEND_BASE_URL=http://localhost:3000
if [ "${KAKAO_MODE:-mock}" = "real" ]; then
  # Manual testing with the real Kakao app: KAKAO_* / FRONTEND_BASE_URL come from the repo-root .env
  # (never committed, never printed). The E2E Kakao test expects the mock and fails in this mode.
  set -a; . "$ROOT/.env"; set +a
  : "${KAKAO_REST_API_KEY:?KAKAO_REST_API_KEY missing in .env}"
  unset KAKAO_AUTH_BASE_URL KAKAO_API_BASE_URL
else
  # Kakao → local mock (scripts/mock-kakao.mjs on :4810). Test-only values, not real keys.
  export KAKAO_REST_API_KEY=e2e-kakao-client KAKAO_CLIENT_SECRET=e2e-kakao-secret
  export KAKAO_REDIRECT_URI=http://localhost:8080/api/v1/auth/kakao/callback
  export KAKAO_AUTH_BASE_URL=http://localhost:4810 KAKAO_API_BASE_URL=http://localhost:4810
fi
cd "$ROOT/backend" && exec ./gradlew bootRun --console=plain -q
