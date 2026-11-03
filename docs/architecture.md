# Architecture

```
┌──────────────────────── Student browser ────────────────────────┐
│ getUserMedia (320×240, ~2–5 fps used)                            │
│   └─ lib/vision (W1): MediaPipe Tasks Vision, WASM, in a Worker   │
│        FaceDetector (BlazeFace short-range)                      │
│        PoseLandmarker (lite) → shoulders visibility              │
│        ObjectDetector (EfficientDet-Lite0, COCO "cell phone")     │
│   └─ engine (W1): pure state machine, thresholds + hysteresis    │
│   └─ session (C0): eventId/seq, ordered retry queue, heartbeat   │
│   └─ UI (W3): Next.js App Router + Tailwind                      │
└───────────────┬─────────────────────────────────────────────────┘
                │ JSON only (transitions, heartbeats) — no media
                ▼
┌──────────────────────── Spring Boot (W2) ───────────────────────┐
│ Security: JWT (HS256, oauth2-resource-server), role + ownership  │
│ SessionService: row lock → event + interval + session (1 tx)     │
│ HeartbeatTimeoutScheduler (10 s) → UNKNOWN at verifiedUntil      │
│ ReportService: lateness (09:00 KST), totals, streaks             │
│ SseHub: per-student + per-teacher emitters, 25 s ping            │
└───────────────┬─────────────────────────────────────────────────┘
                ▼
        PostgreSQL 17 (Flyway) — users, teacher_students,
        study_sessions, activity_intervals, monitoring_events
```

## Key decisions

| Decision | Choice | Why |
|---|---|---|
| Spring Boot | 4.1.x on Java 21 | Current GA line; Boot 4 baseline is Java 17, verified building on Temurin 21. |
| Auth | Stateless JWT (HS256 secret from `JWT_SECRET`) via `spring-boot-starter-oauth2-resource-server` + `NimbusJwtEncoder` | No extra JWT library; standard Spring Security resource-server validation. |
| SSE auth | `fetch` streaming with Bearer header | `EventSource` cannot set headers; avoids tokens in URLs/logs. |
| Event model | Transitions only + 30 s heartbeat | No per-frame DB writes; server can detect silence. |
| Time authority | Server clamps client `detectedAt` | Client clocks can't inflate focus time or rewrite history. |
| Overlap safety | Postgres `EXCLUDE` constraint + partial unique indexes | Integrity enforced by DB, not just app code. |
| Inference location | Browser (WASM, Worker preferred) | Privacy requirement: media never leaves the device. |
| Frontend ↔ backend | Next.js is UI only; calls Spring at `NEXT_PUBLIC_API_BASE_URL` with CORS | Business logic must live in Spring. |

## Ports (dev)

| Service | Port |
|---|---|
| Next.js | 3000 |
| Spring Boot | 8080 |
| PostgreSQL (compose) | 5433 → 5432 |
