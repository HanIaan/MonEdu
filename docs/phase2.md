# Phase 2 — accuracy, performance, reliability (coordination log)

Baseline: tag `phase1-mvp` (91cc080). Integration branch: `agent/claude-coordinator`.
No remote push / PR / deployment without explicit user approval.

## Task table

| Task | Owner | Branch | Scope (owned paths only) |
|---|---|---|---|
| P2-W1 | W1 Claude (separate session from C0) | `agent/claude-vision` | phone-detection comparison, pet rejection, sleep/attention feasibility, adaptive cadence in engine |
| P2-W2 | W2 Codex | `agent/codex-backend` | load test 10/100/1000, DB/SSE/pool review, security regression tests |
| P2-W3 | W3 Lablup DeepSeek | `agent/lablup-frontend` | render/SSE optimisation, camera/model/low-power status UX, privacy UX |
| P2-C0 | C0 | `agent/claude-coordinator` | contract v1.2, full E2E (Chromium + WebKit), phone E2E, 30 min+ soak with process CPU, merges, docs |

## Decisions (C0)

- **Adaptive cadence lives in the engine (W1), not the UI (W3).** The scheduler, inference timing and
  frame dropping are in `features/monitoring/engine/controller.ts` (W1-owned). W3 consumes the v1.2
  perf fields and explains the accuracy impact. Reason: file ownership + the scheduler is the only place
  that knows inference timing.
- **Contract v1.2 is additive and optional** (see `contracts/monitoring-events.md` §1b) so W1 and W3 can
  work in parallel without a lock-step change.
- **No threshold-only fixes.** Lowering `phoneMinScore` / `presenceMinScore` alone is rejected; any
  default change must come with the measured precision/recall table.
- **Unverified sleep/eyes-closed detection is not shipped** in Phase 2 (research only).
- **Load tests run against an isolated backend + database** (not the C0 E2E instance on 8080/5433) so
  measurements and E2E do not interfere.

## Merge log (all verified by C0 before/after merge)

| Order | Commit merged | Worker | C0 verification |
|---|---|---|---|
| 1 | `4493858` P2-W3 | W3 | paths ✓, no test-id removed, Vitest 160/160, build ✓, E2E ui+camera+WebKit 23/23 |
| 2 | `fa1ebf9` P2-W3b (lastReason cause, SSE maxWait — defect found by C0 review) | W3 | Vitest 165/165, targeted E2E 8/8 |
| 3 | `07ae05b` P2-W2 | W2 | paths ✓, 34 original test methods kept, `./gradlew test` 61/61, API E2E 8/8, OpenAPI↔Spring 12/12 |
| 4 | `f07ac47` P2-W1 | W1 | paths ✓ (merge-base diff), Vitest 194/194 |
| 5 | `361548d` P2-W1b | W1 | then C0 set camera 640×480 (`b6bbef2`), Vitest 194/194 |
| 6 | `3f01d13` P2-W2b (timeout recovery + seeded-DB Flyway upgrade — defect found by C0 at integration) | W2 | `./gradlew test` 71/71; real dev DB boots without workaround |

## Contract changes (v1.2)
- optional `FrameObservation.person*`, `MonitoringPerf` adaptive fields, `MonitoringSnapshot.lastReason` (C0)
- presence rule requires COCO person evidence (W1 CCR, measured) — state-machine.md §2
- camera default 640×480 (W1 CCR, measured) — contracts.ts, state-machine.md thresholds
- timeout recovery `effectiveAt = serverNow` (W2 CCR, measured +90 s outage credit) — state-machine.md §4,
  monitoring-events.md §3, openapi.yaml prose. No endpoint/field/enum change; 12/12 operations unchanged.

## Defects found during integration
1. SSE coalescing used trailing debounce only → continuous events could postpone dashboard refresh to the
   30 s fallback (C0 review; fixed by W3 maxWait 2 s + test).
2. Heartbeat-first reconnect credited the outage as focus (+90 s) (W2 load/reliability probe; contract
   fixed by C0, implemented by W2; E2E asserts the outage stays UNKNOWN).
3. Existing demo DBs (V1000 seed applied) failed to boot after adding V2 (C0 at integration restart;
   fixed by W2 with Flyway out-of-order + upgrade regression tests).
4. PHONE_SUSPECTED carried `phoneScore: 0` from a face/pose-only tick (W1; fixed).
