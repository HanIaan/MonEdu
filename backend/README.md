# Study Monitor backend

Java 21, Spring Boot 4.1.2, PostgreSQL 17. The binding API and accounting rules live in
`../docs/contracts/` and `../docs/database.md`.

## Run locally

From `backend/`, with Docker running:

```sh
export JAVA_HOME=/Users/iaan/Library/Java/JavaVirtualMachines/temurin-21.0.8/Contents/Home
docker compose -f ../infra/docker-compose.yml up -d postgres
export JWT_SECRET="$(openssl rand -base64 48)"
export SEED_DEMO_DATA=true
export FLYWAY_LOCATIONS=classpath:db/migration,classpath:db/seed
./gradlew bootRun
```

The default database connection uses `study_monitor` for database/user/password on port 5433;
set `DB_URL`, `DB_USERNAME`, and `DB_PASSWORD` for another database. Demo seeding requires
`SEED_DEMO_DATA=true`; merely listing the seed location does not enable it. Turning seeding off
does not remove demo accounts already installed in a database. All demo accounts use `demo1234!`.

`JWT_SECRET` must contain at least 32 UTF-8 bytes. JWTs use HS256 and expire after `JWT_TTL`
(default `PT12H`). `CORS_ALLOWED_ORIGINS` is a comma-separated list (default `http://localhost:3000`).
`/v3/api-docs` and `/actuator/health` are public. SSE uses bearer authorization headers.

## Verify

```sh
./gradlew test
curl --fail-with-body http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  --data '{"email":"student1@demo.local","password":"demo1234!"}'
```

Tests use Testcontainers PostgreSQL 17, real Flyway migrations, MockMvc, and an injected mutable
clock. The `test` profile supplies its own JWT secret and enables isolated demo fixtures.

## Implementation notes

- `Store` is an EntityManager-backed repository. Mutation services lock session rows and commit
  each request atomically. Starts additionally lock the student account so concurrent initial
  starts serialize. Transition keys take a transaction-scoped advisory lock because event IDs
  are globally unique, including attempts to reuse them across different sessions.
- Old intervals are flushed before new intervals are inserted. PostgreSQL enforces a single
  active session, a single open interval, positive closed durations, and no overlapping ranges.
- Timeouts are checked by the scheduler and before heartbeat/transition mutations. Focus ends at
  `verifiedUntil`; heartbeats never restore focus after timeout. Reports use the contract's
  45-second live-end grace and aggregate durations before flooring totals to seconds.
- SSE recipients are captured inside the mutation transaction, then notified only after commit.
  The registry is process-local; missed notifications are recovered by clients refetching reports
  on reconnect, as specified in the protocol.
- Build a non-root Temurin 21 runtime image with `docker build -t study-monitor-backend .`.
