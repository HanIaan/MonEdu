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
