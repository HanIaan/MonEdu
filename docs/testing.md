# Test strategy (owner: C0)

| Layer | Tool | Where | Owner |
|---|---|---|---|
| State machine, vision adapters, controller | Vitest (jsdom, fake clocks) | `frontend/src/features/monitoring/engine/**/*.test.ts`, `frontend/src/lib/vision/**` | W1 |
| Session sync (seq, retry, heartbeat) | Vitest (fake timers) | `frontend/src/features/monitoring/session/sync.test.ts` | C0 |
| UI components | Vitest + Testing Library | `frontend/src/**/*.test.tsx` | W3 |
| Backend services, security, SQL constraints, SSE | JUnit 5 + MockMvc + Testcontainers (Postgres 17), injected `Clock` | `backend/src/test` | W2 |
| End-to-end | Playwright (Chromium + WebKit engine) against real Spring Boot + Postgres + Next.js, **real MediaPipe models** | `tests/e2e` | C0 |

## Scenario matrix

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
| frozen camera frames (track live) | frameFreshness unit · E2E `frozen camera frames → UNKNOWN` (Chromium + WebKit) |
| hidden analysis video paused by browser | controller unit · E2E `browser pauses the hidden analysis video` |
| heartbeat stopped | backend timeout test · E2E `@slow heartbeat lost > 90 s (network down)` |
| UNKNOWN cause shown | status unit (W3) · E2E camera stop → `unknown-state[data-reason=CAMERA_STOPPED]` |
| network reconnect | sync unit · E2E offline → queue drains |
| duplicate event | backend concurrency test · E2E API duplicate + 8 concurrent posts |
| end → restart | backend · E2E API (no overlapping intervals, clamp to new session start) |
| teacher accessing another teacher's student | backend · E2E API + UI `access-denied` |
| long-run memory | E2E `@slow soak` (CDP heap/listeners/CPU, `SOAK_MINUTES`) |
| long-run CPU/FPS/latency (Phase 2) | `SOAK_LONG=1` project `soak-long` (process-tree CPU via `ps`, inference p95, server latency, accounting) |
| backend load 10/100/1000 users | `backend/loadtest` (W2) — see its RESULTS.md |
| phone / pet / sleep accuracy | `frontend/bench/vision` (W1) — see its RESULTS.md |
| accounts v1.3 (sign-up, policy, refresh rotation, logout, lockout, invite codes, Kakao via mock) | backend `AccountsIntegrationTests`, `KakaoIntegrationTests` (W2) · lib/api `client.test.ts` · E2E `api.account`, `ui.account` (mock: `scripts/mock-kakao.mjs` on :4810) |
| real-webcam field accuracy (seated / writing / reading / phone / away / head down) | `WEBCAM_EVAL=1` project `webcam-eval` — human-in-the-loop, see `docs/webcam-eval.md` (no media recorded) |

## Commands
```bash
cd frontend && npm ci && npm run typecheck && npm run lint && npm test
cd backend && ./gradlew test                       # JAVA_HOME = JDK 21, Docker running
cd tests/e2e && npm ci && npx playwright install chromium
npm run test:fast                                  # starts Postgres+Spring+Next if not running
npm test                                           # incl. @slow (AWAY 30 s, heartbeat loss ~2 min, soak 5 min)

# Phase 2 long soak (own browser server; 30 min default; scene goes empty 45 s every 10 min)
scripts/ensure-soak-user.sh                        # adds soak@demo.local to the local dev DB (additive)
SOAK_LONG=1 SOAK_MINUTES=30 npx playwright test --project soak-long

# Real-webcam field evaluation (headed, ~10 min, the person consents in the app; no media recorded)
WEBCAM_EVAL=1 WEBCAM_EVAL_NOTE="lighting, camera, distance" npx playwright test --project webcam-eval
WEBCAM_EVAL=1 WEBCAM_EVAL_FAKE=1 npx playwright test --project webcam-eval   # harness dry run (photos, not field data)
node scripts/webcam-eval-summary.mjs                                         # aggregate runs
```

**Real Safari is not covered by any automated test.** Playwright WebKit shares the engine only;
see `docs/safari-manual-checklist.md` for the manual checks.

### Measurement notes
- CDP `Performance.TaskDuration` is **wall time** of main-thread tasks and depends on machine load:
  the same 5-min soak spec read 21.9 % while W1's benchmark, W2's 1000-user load test and another
  camera session ran concurrently, and 1.8 % (2-min run) standalone at load average 3.2. Phase 1's
  15.8 % figure was measured in a full-suite run and is not comparable. The long soak therefore also
  records per-process **CPU time** from `ps` plus the 1-min load average for every sample.
- "AI worker CPU" in the long soak = renderer-process CPU − main-thread time: a **derived** figure
  (the renderer also runs the compositor and other threads).
- Browser-wide CPU includes the synthetic canvas camera (drawing 640×480 at 15 fps + captureStream),
  which a real webcam does not cost in the renderer.
