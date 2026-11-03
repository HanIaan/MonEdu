# Monitoring Events & Sync Protocol (contract v1)

Owner: C0. Client side implemented in `frontend/src/features/monitoring/session/` (C0),
server side in `backend/` (W2). Wire schemas live in `openapi.yaml`.

## 1. Data flow

```
camera → lib/vision (W1, in-browser MediaPipe) → FrameObservation
       → engine/ state machine (W1) → EngineTransition
       → session/ sync (C0): assign eventId+seq, queue, POST /transitions, heartbeat
       → backend (W2): validate, single-transaction interval update, SSE fan-out
       → me/stream, teacher/stream → dashboards (W3) refetch study-day report
```

Nothing but `TransitionRequest` / `HeartbeatRequest` JSON leaves the browser. No frames, images,
landmarks, boxes, or embeddings — ever.

## 1a. Analysis video ownership (contract v1.1)

The `<video>` that feeds MediaPipe is created and owned by the session layer
(`features/monitoring/session/analysisVideo.ts`): one element, attached to `<body>`, 2×2 px,
opacity 0.01, never `display:none`. UI previews only render `StudySessionApi.cameraStream` in their own
`<video>`; mounting, hiding or unmounting a preview never touches the analysis pipeline.
The engine only analyses **new** frames (`requestVideoFrameCallback` is authoritative once it has fired;
`currentTime` is a wall clock for MediaStream sources and only a fallback), so frozen frames or a
browser-paused video become `UNKNOWN (INFERENCE_STALLED)` within `staleFrameMs` instead of accruing focus.

## 1b. Phase 2 additions (contract v1.2)

All additions are **optional** fields in `contracts.ts` (no wire/API change; `openapi.yaml` unchanged):
- `FrameObservation.personDetected?` / `personScore?` — COCO `person` from the object detector, for
  rejecting non-human faces (pets). Presence-rule changes based on it require a `state-machine.md`
  update (W1 files a CONTRACT_CHANGE_REQUEST with measurements; C0 applies it).
- `MonitoringPerf.p95InferenceMs?`, `effectiveIntervalMs?`, `effectivePhoneIntervalMs?`, `lowPower?`,
  `framesDropped?` — adaptive-cadence telemetry produced by the engine (W1), displayed by the UI (W3).
Producers SHOULD populate them; consumers MUST treat `undefined` as "not reported".
Nothing in these fields leaves the browser.

## 2. Client obligations

1. `eventId` = `crypto.randomUUID()` generated once per transition and reused on every retry.
2. `seq` starts at 1 per session and increments by 1 per generated transition. Persist
   `{sessionId, nextSeq, pendingQueue}` in `sessionStorage` so a reload can resume.
3. Send transitions **in seq order**, one in flight at a time. Retry with exponential backoff
   (1 s → 30 s cap) on network errors and 5xx. On `409 SEQ_OUT_OF_ORDER` for an event, drop it
   (the server already has newer state). On `409 SESSION_ENDED`, stop and surface to UI.
4. Heartbeat every `heartbeatIntervalSec` (server-provided, default 30 s) while a session is ACTIVE —
   including during BREAK and UNKNOWN — with `cameraActive`, `pageVisible`, `clientState`, `lastSeq`.
5. If a heartbeat response has `timedOut: true` and the engine state is not UNKNOWN, enqueue a
   transition `{state: <engine state>, reason: RECONNECTED, detectedAt: now}`.
6. Never send per-frame data. Expected volume: a few transitions per minute at most + 2 heartbeats/min.
7. On `pagehide`, attempt `end` only if the student explicitly ended; otherwise let the heartbeat
   timeout mark UNKNOWN (closing a tab is not "ended study").

## 3. Server obligations

| Rule | Behaviour |
|---|---|
| Ownership | Only the session's student may post transitions/heartbeat/end → else 403 `FORBIDDEN`. |
| Ended | Transition/heartbeat on ENDED session → 409 `SESSION_ENDED`. `end` on ENDED → 200 (idempotent). |
| Idempotency | `monitoring_events.event_id` UNIQUE. Replay with identical `(seq,state,reason,detectedAt)` → 200 same body, `duplicate: true`. Different payload → 409 `EVENT_ID_CONFLICT`. |
| Ordering | `seq > session.last_seq` required, else 409 `SEQ_OUT_OF_ORDER`. Gaps allowed. |
| Clock | `serverReceivedAt` recorded. `detectedAt > now + 5 s` → 400 `CLOCK_SKEW`. `detectedAt` before session start is clamped (see state-machine §4). |
| Atomicity | Lock the session row (`SELECT … FOR UPDATE`), then event insert + interval close/open + session update in one transaction. Concurrent duplicate posts must yield exactly one stored event. |
| Fan-out | After commit, publish `StreamEvent` to the student's own stream and to streams of every assigned teacher. |
| Timeout | See state-machine §4. Publishes `STATE_CHANGED` with reason `HEARTBEAT_TIMEOUT`. |

## 4. Server-originated events

Stored in `monitoring_events` with `seq = NULL`, `source = 'SERVER'`:
`SESSION_STARTED`, `HEARTBEAT_TIMEOUT`, `CAMERA_STOPPED` (forced via heartbeat), `SESSION_ENDED`,
`SESSION_REPLACED`.

## 5. SSE framing

```
event: monitoring
id: 6f1c…            (monitoring_events.id)
data: {"type":"STATE_CHANGED","studentId":"…","sessionId":"…","state":"AWAY","reason":"PRESENCE_LOST","at":"2026-11-03T01:02:03Z"}

: ping               (every 25 s)
```

Clients use `fetch` with `Authorization: Bearer` (EventSource cannot send headers), reconnect with
backoff, and on (re)connect refetch the report — so missed events are harmless.

## 6. Example

```http
POST /api/v1/study-sessions/7d0e…/transitions
Authorization: Bearer eyJ…
Content-Type: application/json

{"eventId":"0b6c3a1e-4c52-4d8e-9a39-2c0a4b1f8e11","seq":1,"state":"FOCUS_ESTIMATED",
 "reason":"SEATED_CONFIRMED","detectedAt":"2026-11-03T00:13:22.000Z","confidence":0.91,
 "signals":{"faceDetected":true,"upperBodyDetected":true,"phoneDetected":false,"cameraActive":true,"pageVisible":true}}
```

```json
{"eventId":"0b6c3a1e-4c52-4d8e-9a39-2c0a4b1f8e11","seq":1,"duplicate":false,
 "serverReceivedAt":"2026-11-03T00:13:37.412Z","effectiveAt":"2026-11-03T00:13:22.000Z",
 "currentState":"FOCUS_ESTIMATED","currentStateSince":"2026-11-03T00:13:22.000Z","intervalChanged":true}
```
