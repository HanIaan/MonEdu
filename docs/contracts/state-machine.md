# State Machine & Time Rules (contract v1)

Owner: C0. Implemented by W1 (client engine, `frontend/src/features/monitoring/engine/`)
and W2 (server interval accounting, `backend/`). Both MUST follow this document; change requests go
to C0.

## 1. States

| State | Meaning | Counts as focus? |
|---|---|---|
| `FOCUS_ESTIMATED` | Student confirmed present (face **or** upper body), no sustained phone evidence. *Estimate*, not proof of attention. | **yes** |
| `DISTRACTION_SUSPECTED` | Present, but a phone has been detected continuously for `phoneSuspectMs`. *Suspicion*, not proof of use. | no |
| `AWAY` | No face and no upper body for `awayMs`, with good frame quality. | no |
| `UNKNOWN` | Cannot measure: camera off/denied, model not loaded/error, low confidence, inference stalled (e.g. background tab), heartbeat lost, session just started. | no |
| `BREAK` | Student-declared break. Engine inference may pause. | no |

A session always starts in `UNKNOWN` (server reason `SESSION_STARTED`).

## 2. Per-frame evidence (engine)

Each inference tick produces a `FrameObservation` (see `frontend/src/features/monitoring/contracts.ts`).
The engine classifies it as:

- **PRESENT** — `faceScore >= presenceMinScore` **or** upper body visible
  (both shoulders with landmark visibility `>= poseMinVisibility`).
  *Face missing but shoulders visible is PRESENT* (e.g. head down writing).
- **ABSENT** — frame quality OK, no face and no upper body
  (`faceScore < absentMaxScore` and pose not visible).
- **UNCERTAIN** — anything else: grey-zone scores, frame too dark/uniform, a model failed this tick.

Phone evidence is evaluated only on PRESENT frames: `phoneScore >= phoneMinScore` for COCO class
`cell phone`. A phone detection is *never* treated as confirmed usage.

Head pose / gaze direction MUST NOT be used as a distraction signal in v1 (looking down at a
notebook is normal studying).

## 3. Transitions (engine)

All durations are measured with **elapsed wall-clock time** (`now - runStartedAt`, from
`performance.timeOrigin + performance.now()`), never by counting ticks. A *run* is a contiguous
period of the same evidence. A run is broken only when contrary evidence persists for
`debounceMs` (hysteresis); single contrary frames do not reset it.

| From | To | Condition | Reason | `detectedAt` |
|---|---|---|---|---|
| UNKNOWN, AWAY | FOCUS_ESTIMATED | PRESENT run `>= seatedConfirmMs` (15 s) | `SEATED_CONFIRMED` | run onset |
| FOCUS_ESTIMATED | DISTRACTION_SUSPECTED | phone run `>= phoneSuspectMs` (20 s) | `PHONE_SUSPECTED` | run onset |
| DISTRACTION_SUSPECTED | FOCUS_ESTIMATED | PRESENT & no-phone run `>= focusResumeMs` (15 s) | `FOCUS_RESUMED` | run onset |
| FOCUS_ESTIMATED, DISTRACTION_SUSPECTED | AWAY | ABSENT run `>= awayMs` (30 s) | `PRESENCE_LOST` | run onset |
| FOCUS_ESTIMATED, DISTRACTION_SUSPECTED, AWAY | UNKNOWN | UNCERTAIN run `>= uncertainMs` (10 s) | `LOW_CONFIDENCE` | run onset |
| any except BREAK | UNKNOWN | video track ended / camera stopped | `CAMERA_STOPPED` | now |
| any except BREAK | UNKNOWN | permission denied / revoked | `CAMERA_PERMISSION_DENIED` | now |
| any except BREAK | UNKNOWN | model load/inference error | `MODEL_ERROR` | now |
| any except BREAK, UNKNOWN | UNKNOWN | no frame processed for `staleFrameMs` (5 s) — checked on every tick and on `visibilitychange` | `INFERENCE_STALLED` | last processed frame time |
| any except BREAK | UNKNOWN | student pauses monitoring | `MONITORING_PAUSED` | now |
| any | BREAK | student starts break | `BREAK_STARTED` | now |
| BREAK | UNKNOWN | student ends break (then normal 15 s seating) | `BREAK_ENDED` | now |

Notes
- **Onset back-dating:** `detectedAt` is when the evidence *began*, not when the threshold elapsed.
  This is how "seated at 09:13:22" yields `lateSeconds = 802` even though confirmation completes
  at 09:13:37.
- While `UNKNOWN` because of a camera/model problem, focus never accrues.
- After a stall/camera recovery the engine starts fresh evidence runs (it must re-confirm 15 s).
- The engine emits at most one transition per state change; no transition when target == current.

### Thresholds (all configurable, `DEFAULT_ENGINE_CONFIG`)

| Key | Default |
|---|---|
| `seatedConfirmMs` | 15000 |
| `awayMs` | 30000 |
| `phoneSuspectMs` | 20000 |
| `focusResumeMs` | 15000 |
| `uncertainMs` | 10000 |
| `debounceMs` | 3000 |
| `staleFrameMs` | 5000 |
| `presenceMinScore` | 0.6 |
| `absentMaxScore` | 0.3 |
| `poseMinVisibility` | 0.5 |
| `phoneMinScore` | 0.5 |
| `inferenceIntervalMs` | 500 (face + pose) |
| `phoneIntervalMs` | 1000 (object detector) |

## 4. Server interval accounting

- Exactly one **open** interval (`ended_at IS NULL`) per ACTIVE session; none for ENDED sessions.
- Intervals of a student never overlap (DB exclusion constraint on `tstzrange(started_at, ended_at)`).
- On an accepted transition with `state != currentState`:
  `effectiveAt = min(serverNow, max(detectedAt, currentInterval.startedAt))`;
  close current interval at `effectiveAt`, open new interval at `effectiveAt`. Zero-length intervals
  are deleted rather than stored.
- `verifiedUntil = max(verifiedUntil, effectiveAt)` on transitions, and `= serverNow` on heartbeats
  with `cameraActive = true`.
- **Heartbeat timeout** (scheduler every 10 s): ACTIVE session with
  `lastHeartbeatAt` (or `startedAt` if none) older than `heartbeatTimeoutSec` (90 s) and current state
  not in {UNKNOWN, BREAK} → close current interval at `verifiedUntil` and open `UNKNOWN`
  (`HEARTBEAT_TIMEOUT`) at `verifiedUntil`. Unverified time is therefore never counted as focus.
- **Late events after reconnect:** queued client events are applied with the same `effectiveAt` rule,
  so they cannot rewrite history before the current interval (offline time stays UNKNOWN).
- **End:** close open interval at `clamp(endedAt, currentInterval.startedAt, serverNow)`.
- **Replace:** starting a session while one is ACTIVE ends the old one at its `verifiedUntil`
  (`SESSION_REPLACED`).

## 5. Day report computation (Asia/Seoul)

- `studyDate` = Asia/Seoul local date of `session.startedAt`. A day report includes all sessions with
  that `studyDate` (intervals are attributed to the session's study date; v1 does not split
  intervals at midnight).
- `referenceTime` = `date` 09:00:00 Asia/Seoul (= 00:00:00Z same date).
- `firstSeatedAt` = earliest `startedAt` among intervals with state `FOCUS_ESTIMATED` or
  `DISTRACTION_SUSPECTED`.
- `lateSeconds` = `max(0, floor(firstSeatedAt - referenceTime))`; `lateStatus` = `ON_TIME` if
  `lateSeconds == 0`, `LATE` if `> 0`, `NOT_SEATED` if `firstSeatedAt` is null.
  - 08:55:00 KST → 0 s, ON_TIME. 09:13:22 KST → 802 s, LATE.
- Durations of closed intervals: `endedAt - startedAt`. For the open interval, measure to
  `liveEnd = (serverNow - verifiedUntil <= 45 s) ? serverNow : verifiedUntil` so a stale client
  stops accruing immediately and the number matches what the timeout will finalize.
- `totals.*Seconds` = sum of durations per state (integer seconds, floor at the end).
- Focus **streak** = maximal run of time-adjacent `FOCUS_ESTIMATED` intervals (end == next start).
  `longestStreakSeconds` = max streak of the day; `currentStreakSeconds` = the streak containing the
  open interval if it is `FOCUS_ESTIMATED`, else 0.

## 6. Fairness

All states are *estimates*. The UI must label them as such ("집중 추정", "비집중 의심") and must not
present automated judgments as confirmed misconduct. Teachers see the evidence timeline, not a verdict.
