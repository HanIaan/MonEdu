# State Machine & Time Rules (contract v1, engine rules v1.3)

Owner: C0. Implemented by W1 (client engine, `frontend/src/features/monitoring/engine/`)
and W2 (server interval accounting, `backend/`). Both MUST follow this document; change requests go
to C0.

## 1. States

| State | Meaning | Counts as focus? |
|---|---|---|
| `FOCUS_ESTIMATED` | Student confirmed present (person detected with face or upper body — v1.2), no sustained phone evidence. *Estimate*, not proof of attention. | **yes** |
| `DISTRACTION_SUSPECTED` | Present, but a phone has been detected repeatedly for `phoneSuspectMs` (reason `PHONE_SUSPECTED`), or — v1.3 — both eyes have stayed closed for `drowsyMs` (reason `DROWSINESS_SUSPECTED`). *Suspicion*, not proof of use / sleep. | no |
| `AWAY` | No face, no upper body and no person detection for `awayMs`, with good frame quality. | no |
| `UNKNOWN` | Cannot measure: camera off/denied, model not loaded/error, low confidence, inference stalled (e.g. background tab), heartbeat lost, session just started. | no |
| `BREAK` | Student-declared break. Engine inference may pause. | no |

A session always starts in `UNKNOWN` (server reason `SESSION_STARTED`).

## 2. Per-frame evidence (engine)

Each inference tick produces a `FrameObservation` (see `frontend/src/features/monitoring/contracts.ts`).
The engine classifies it as:

v1.2 rule (W1 CCR approved by C0; measured in `frontend/bench/vision/RESULTS.md` §B):

- **PRESENT** — a COCO `person` detection from the object detector (`personScore >= 0.5`; evidence
  from the most recent detector tick is held for at most 5 s) **and** at least one of:
  `faceScore >= presenceMinScore`; upper body visible (both shoulders with visibility
  `>= poseMinVisibility`); `personScore >= 0.7`.
  *Face missing but shoulders visible is PRESENT* (e.g. head down writing).
  **A face alone, or shoulders alone, without a person detection is never PRESENT** (pets: BlazeFace
  scored 0.71–0.79 on cats/dogs, and the pose model reports shoulders on ~15 % of pet photos).
- **ABSENT** — frame quality OK, `faceScore < absentMaxScore`, upper body not visible, and no person
  detected in this frame.
- **UNCERTAIN** — anything else: face/shoulders without a person detection (pet, poster, object
  detector not run or failed for > 5 s), a person detection below 0.7 without face/shoulders, grey-zone
  scores, frame too dark/uniform, a model failed this tick. When human-ness is uncertain the engine
  prefers UNCERTAIN (→ UNKNOWN after `uncertainMs`) over PRESENT.

Measured effect (per frame, @320): pets PRESENT 27/100 → 0/100, empty scenes 6/60 → 0/60, people with
a hidden face (head turned/bowed) 26/43 → 41/43, upper-body people 98/100 → 99/100.

Phone evidence is evaluated only on PRESENT frames: `phoneScore >= phoneMinScore` for COCO class
`cell phone`. A phone detection is *never* treated as confirmed usage.

v1.3 eye evidence is evaluated only on PRESENT frames that carry `eyesClosedScore`
(= min(eyeBlinkLeft, eyeBlinkRight) of MediaPipe Face Landmarker). The landmarker only runs on ticks
whose face score is `>= presenceMinScore` (a face bowed over a notebook scores lower and is not
measured). "Closed" = `eyesClosedScore >= eyesClosedMinScore`.

Head pose / gaze direction MUST NOT be used as a distraction signal (looking down at a notebook is
normal studying). Eye closure is not head pose: a face that cannot be measured is never "closed".

## 3. Transitions (engine)

All durations are measured with **elapsed wall-clock time** (`now - runStartedAt`, from
`performance.timeOrigin + performance.now()`), never by counting ticks. A *run* is a contiguous
period of the same evidence. A run is broken only when contrary evidence persists for
`debounceMs` (hysteresis); single contrary frames do not reset it. Exceptions (v1.3):

- **Phone = repeated detection, not a run.** The object detector misses a visible phone in many
  frames, so a phone *episode* starts at the first detection and ends after 6 s (≥ 2.5 detector
  intervals in low-power mode) without any detection. Suspicion needs: detections spanning
  `>= phoneSuspectMs` from the episode onset, and in the last `phoneSuspectMs` ≥ 50 % of detector ticks
  (and ≥ 3) saw the phone. The episode is dropped whenever the student is not PRESENT.
- **Eyes** use a 1 s debounce (a blink or a second of open eyes breaks a closed run) and eye evidence
  older than 5 s (face no longer measurable) no longer counts.

| From | To | Condition | Reason | `detectedAt` |
|---|---|---|---|---|
| UNKNOWN, AWAY | FOCUS_ESTIMATED | PRESENT run `>= seatedConfirmMs` (3 s; v1.3, was 15 s) | `SEATED_CONFIRMED` | run onset |
| FOCUS_ESTIMATED | DISTRACTION_SUSPECTED | phone episode `>= phoneSuspectMs` (20 s), see above | `PHONE_SUSPECTED` | episode onset |
| FOCUS_ESTIMATED | DISTRACTION_SUSPECTED | eyes-closed run `>= drowsyMs` (15 s) (v1.3) | `DROWSINESS_SUSPECTED` | run onset |
| DISTRACTION_SUSPECTED | FOCUS_ESTIMATED | PRESENT, no phone episode, eyes not closed, for `>= focusResumeMs` (15 s) | `FOCUS_RESUMED` | when the last cue went away |
| FOCUS_ESTIMATED, DISTRACTION_SUSPECTED | AWAY | ABSENT run `>= awayMs` (30 s) | `PRESENCE_LOST` | run onset |
| FOCUS_ESTIMATED, DISTRACTION_SUSPECTED, AWAY | UNKNOWN | UNCERTAIN run `>= uncertainMs` (10 s) | `LOW_CONFIDENCE` | run onset |
| any except BREAK | UNKNOWN | video track ended / camera stopped | `CAMERA_STOPPED` | now |
| any except BREAK | UNKNOWN | permission denied / revoked | `CAMERA_PERMISSION_DENIED` | now |
| any except BREAK | UNKNOWN | model load/inference error | `MODEL_ERROR` | now |
| any except BREAK, UNKNOWN | UNKNOWN | no frame processed for `staleFrameMs` (5 s) — checked on every tick and on `visibilitychange` | `INFERENCE_STALLED` | last processed frame time |
| any except BREAK | UNKNOWN | student pauses monitoring | `MONITORING_PAUSED` | now |
| any | BREAK | student starts break | `BREAK_STARTED` | now |
| BREAK | UNKNOWN | student ends break (then normal 3 s seating) | `BREAK_ENDED` | now |

Notes
- **Onset back-dating:** `detectedAt` is when the evidence *began*, not when the threshold elapsed.
  This is how "seated at 09:13:22" yields `lateSeconds = 802` even though confirmation completes
  at 09:13:25.
- While `UNKNOWN` because of a camera/model problem, focus never accrues.
- After a stall/camera recovery the engine starts fresh evidence runs (it must re-confirm 3 s).
- The engine emits at most one transition per state change; no transition when target == current.

### Thresholds (all configurable, `DEFAULT_ENGINE_CONFIG`)

| Key | Default |
|---|---|
| `seatedConfirmMs` | 3000 (v1.3; was 15000) |
| `awayMs` | 30000 |
| `phoneSuspectMs` | 20000 |
| `drowsyMs` | 15000 (v1.3) |
| `focusResumeMs` | 15000 |
| `uncertainMs` | 10000 |
| `debounceMs` | 3000 |
| `staleFrameMs` | 5000 |
| `presenceMinScore` | 0.6 |
| `absentMaxScore` | 0.3 |
| `poseMinVisibility` | 0.5 |
| `phoneMinScore` | 0.4 (v1.3; was 0.5) |
| `eyesClosedMinScore` | 0.6 (v1.3) |
| `inferenceIntervalMs` | 500 (face + pose) |
| `phoneIntervalMs` | 1000 (object detector) |
| `camera` | 640×480 @ 15 fps (`ideal` constraints; v1.2 — was 320×240, see bench §A) |

Engine-internal (not in `EngineConfig`, v1.2): person (COCO) 0.5 detected, 0.7 alone-sufficient,
held 5 s. v1.3: phone episode gap 6 s, ratio ≥ 0.5, ≥ 3 detections; eyes debounce 1 s, hold 5 s.
Measured effect of v1.3: `frontend/bench/vision/RESULTS.md` §E. Adaptive cadence (low-power): face/pose and detector intervals ×1/1.5/2/3/4, capped at
2 s / 4 s, when p95 inference > 40 % of the interval; all durations stay elapsed-time based.

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
- **Abandoned session expiry:** independently of the 90 s measurement timeout, any ACTIVE session
  (including UNKNOWN and BREAK) with no heartbeat for more than 5 minutes is ended by the scheduler.
  `endReason = HEARTBEAT_TIMEOUT`; its final interval is closed and `SESSION_ENDED` is published.
  Measurement states close at `verifiedUntil`; BREAK/UNKNOWN close at the later of `verifiedUntil`
  and the last heartbeat, bounded below by the open interval start. The silent grace period is not
  invented as study or break time. A brief interruption below 5 minutes can still reconnect.
- **Late events after reconnect:** queued client events are applied with the same `effectiveAt` rule,
  so they cannot rewrite history before the current interval (offline time stays UNKNOWN).
- **Timeout recovery (contract v1.2, W2 CCR approved by C0):** if the current interval is `UNKNOWN`
  opened by `HEARTBEAT_TIMEOUT` and an accepted transition changes the state, then
  `effectiveAt = serverNow` (regardless of `detectedAt` or reason). Without this, a heartbeat that
  arrives first followed by a queued event detected during the outage would clamp to the UNKNOWN
  interval's start, delete it as zero-length, and credit the outage as focus (measured: +90 s).
  The outage therefore stays UNKNOWN until the server actually receives the recovery transition.
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
  For BREAK/UNKNOWN only, use `max(verifiedUntil, lastHeartbeatAt)` as the confirmation reference:
  these states do not require a running camera. Live heartbeats keep an intentional break current;
  a closed window stops extending it. Display clocks must stop extrapolating from stale reports.
- `totals.*Seconds` = sum of durations per state (integer seconds, floor at the end).
- Focus **streak** = maximal run of time-adjacent `FOCUS_ESTIMATED` intervals (end == next start).
  `longestStreakSeconds` = max streak of the day; `currentStreakSeconds` = the streak containing the
  open interval if it is `FOCUS_ESTIMATED`, else 0.

## 6. Fairness

All states are *estimates*. The UI must label them as such ("집중 추정", "비집중 의심") and must not
present automated judgments as confirmed misconduct. Teachers see the evidence timeline, not a verdict.
