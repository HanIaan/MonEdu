# Study Monitor

웹캠 기반 과외생 학습 모니터링 서비스. 오전 09:00(Asia/Seoul) 기준 지각, 착석, **집중 추정**,
**스마트폰 사용 의심**, 자리비움, 측정 불가, 학습 종료를 자동으로 기록합니다.

- 영상 분석은 **학생 브라우저 안에서만** 실행됩니다 (MediaPipe Tasks Vision, WASM).
  서버로는 상태 전환 JSON과 heartbeat만 전송되며, 영상·이미지·얼굴 특징은 전송/저장되지 않습니다.
- 모든 판정은 *추정*입니다. 자동 판정으로 불이익을 확정하지 않습니다 (`/privacy`).

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · MediaPipe Tasks Vision 1.2.0 |
| Backend | Java 21 · Spring Boot 4.1.2 · Spring Security (JWT resource server) · Spring Data JPA · Flyway · SSE |
| DB | PostgreSQL 17 |
| Tests | Vitest · JUnit 5 + Testcontainers · Playwright |
| Infra | Docker Compose · env-based config · OpenAPI 3.1 (`docs/contracts/openapi.yaml`) |

## Quick start (local dev)

Prerequisites: Node ≥ 20.9, JDK 21, Docker.

```bash
cp .env.example .env
# set JWT_SECRET in .env:  openssl rand -base64 48

# 1) database
docker compose --env-file .env -f infra/docker-compose.yml up -d postgres

# 2) backend  (http://localhost:8080, OpenAPI at /v3/api-docs)
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
set -a; source .env; set +a
cd backend && ./gradlew bootRun

# 3) frontend (http://localhost:3000)
cd frontend && npm ci && npm run dev
```

Demo accounts (only with `SEED_DEMO_DATA=true`), password `demo1234!`:

| Email | Role | Assigned |
|---|---|---|
| teacher@demo.local | TEACHER | student1, student2 |
| teacher2@demo.local | TEACHER | student3 |
| student1@demo.local · student2@demo.local · student3@demo.local | STUDENT | |

## Full stack in Docker

```bash
docker compose --env-file .env -f infra/docker-compose.yml --profile app up -d --build
```

## Tests

```bash
cd frontend && npm run typecheck && npm run lint && npm test
cd backend && ./gradlew test                    # needs Docker (Testcontainers)
cd tests/e2e && npm ci && npx playwright install chromium
npm run test:fast                               # starts Postgres + Spring + Next if needed
npm test                                        # incl. @slow scenarios and soak (SOAK_MINUTES=5)
```

## Docs

- `docs/architecture.md` — components, decisions, ports
- `docs/contracts/` — OpenAPI, state machine, monitoring event protocol (binding)
- `docs/database.md`, `docs/error-handling.md`, `docs/testing.md`
- `docs/limitations.md` — known technical limits (background tabs, detection accuracy, …)
- `AGENTS.md` — multi-agent file ownership and workflow
