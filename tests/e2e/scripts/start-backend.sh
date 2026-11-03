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
cd "$ROOT/backend" && exec ./gradlew bootRun --console=plain -q
