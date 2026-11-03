# Test strategy (owner: C0)

| Layer | Tool | Where | Owner |
|---|---|---|---|
| State machine, vision adapters, controller | Vitest (jsdom, fake clocks) | `frontend/src/features/monitoring/engine/**/*.test.ts`, `frontend/src/lib/vision/**` | W1 |
| Session sync (seq, retry, heartbeat) | Vitest (fake timers) | `frontend/src/features/monitoring/session/sync.test.ts` | C0 |
| UI components | Vitest + Testing Library | `frontend/src/**/*.test.tsx` | W3 |
| Backend services, security, SQL constraints, SSE | JUnit 5 + MockMvc + Testcontainers (Postgres 17), injected `Clock` | `backend/src/test` | W2 |
| End-to-end | Playwright (Chromium) against real Spring Boot + Postgres + Next.js, **real MediaPipe models** | `tests/e2e` | C0 |

## Scenario matrix (Phase 3)

| Scenario | Covered by |
|---|---|
| 08:55 seated → late 0 s | backend (Clock) · engine onset test |
| 09:13:22 seated → late 802 s | backend (Clock) · engine onset back-dating test · E2E formula check |
| face hidden, upper body visible | engine unit · E2E `camera-person` (profile-face fixture) |
| away ≥ 30 s | engine unit · E2E `@slow nobody → AWAY` (asserts ≥ 29 s) |
| phone detected continuously | engine unit (20 s) · W1 real-model verification (scores) |
| phone false positive | engine unit (intermittent detections → no transition) |
| camera permission denied | E2E `camera-denied` |
| camera stopped mid-session | engine/controller unit · E2E `stopTrack()` |
| tab inactive / frozen | engine stall unit · E2E `@slow frozen tab` (CDP lifecycle freeze) |
| heartbeat stopped | backend timeout test · E2E frozen tab → teacher sees UNKNOWN |
| network reconnect | sync unit · E2E offline → queue drains |
| duplicate event | backend concurrency test · E2E API duplicate + 8 concurrent posts |
| end → restart | backend · E2E API (no overlapping intervals, clamp to new session start) |
| teacher accessing another teacher's student | backend · E2E API + UI `access-denied` |
| long-run memory | E2E `@slow soak` (CDP heap/listeners/CPU, `SOAK_MINUTES`) |

## Commands
```bash
cd frontend && npm ci && npm run typecheck && npm run lint && npm test
cd backend && ./gradlew test                       # JAVA_HOME = JDK 21, Docker running
cd tests/e2e && npm ci && npx playwright install chromium
npm run test:fast                                  # starts Postgres+Spring+Next if not running
npm test                                           # incl. @slow (AWAY 30 s, frozen tab ~2 min, soak 5 min)
```
