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

## Accounts v1.3

`V3__accounts.sql` upgrades V1/V2 databases (including databases already seeded at V1000) without
removing account, assignment or study history. Demo accounts keep null agreement timestamps.
Password sign-up stores the configured `AGREEMENTS_VERSION`; the common-password denylist is
`src/main/resources/common-passwords.txt`.

Access JWTs include a random `jti`. Refresh cookies are HttpOnly, SameSite=Lax, scoped to
`/api/v1/auth`, and Secure by default; set `AUTH_COOKIE_SECURE=false` only for local HTTP.
`REFRESH_TTL` defaults to `P14D`, `REFRESH_REUSE_GRACE` to `PT30S`. Rotation and logout take a
transaction-scoped family advisory lock. Single-use grace is durable: the first replacement's
`issued_at` equals the original token's `revoked_at`; the grace replacement has a strictly later
`issued_at` (at least one PostgreSQL microsecond), while preserving the original revocation time.
A second grace use is rejected. Reuse outside grace revokes every token in that family, including
both concurrent-tab branches. Revocation commits even though the response is 401.

Credential and refresh IP windows are separate and configurable through
`AUTH_IP_LIMIT_PER_MINUTE` (30) and `REFRESH_IP_LIMIT_PER_MINUTE` (120). Email lockouts and student
join limits also use the injected UTC clock. Limits are local to one backend process. Client IP is
the remote socket address; only `TRUSTED_PROXY=true` enables the last `X-Forwarded-For` hop.
Credentialed CORS requires explicit `CORS_ALLOWED_ORIGINS`; wildcards are rejected.

Kakao stays disabled until both `KAKAO_REST_API_KEY` and `KAKAO_REDIRECT_URI` are nonempty.
`KAKAO_CLIENT_SECRET` is optional. `FRONTEND_BASE_URL` controls callback redirects;
`KAKAO_AUTH_BASE_URL` and `KAKAO_API_BASE_URL` default to Kakao and can point to local mocks in tests.
Provider calls time out after five seconds. Only the numeric provider identity is persisted;
provider tokens are discarded. Signup tickets have a separate audience and ten-minute expiry.

Invite generation serializes by teacher with an advisory lock. A join shares a lock on the active
code, so rotation and joining have a defined ordering without holding conflicting user-row locks.
Codes are never deleted/reused; rotation keeps existing teacher/student links. Overview queries
and monitoring event recipients consult current assignments, including links made after SSE opens.

The accounts tests use isolated Testcontainers databases and an ephemeral loopback Kakao mock;
no development backend or development database is used.
