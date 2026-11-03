# Error handling, auth & CORS policy (owner: C0)

## Server (W2)
- Every non-2xx response is RFC 9457 `application/problem+json` with `code` (`ErrorCode` in openapi.yaml).
- 400 `VALIDATION_FAILED` includes `errors[{field,message}]`; 400 `CLOCK_SKEW` for future `detectedAt`.
- 401 `UNAUTHORIZED` (missing/invalid/expired token) · 401 `BAD_CREDENTIALS` (login only; same message
  for unknown email and wrong password — no account enumeration).
- 403 `FORBIDDEN` (wrong role or not the owner) · 403 `STUDENT_NOT_ASSIGNED` (teacher ↔ student).
- 404 `NOT_FOUND` · 409 `SESSION_ENDED` / `SEQ_OUT_OF_ORDER` / `EVENT_ID_CONFLICT`.
- 500 `INTERNAL_ERROR` never leaks stack traces or SQL.

## Client (C0 `lib/api`, W3 UI)
| Situation | Behaviour |
|---|---|
| network error / 5xx / 429 | `ApiError.retryable`; transitions retried by `SessionSync` with backoff 1 s → 30 s, same `eventId`/`seq`; UI shows offline banner + pending count |
| 401 | token cleared, `useAuth` → anonymous → redirect `/login` |
| 403 `STUDENT_NOT_ASSIGNED` | "접근 권한이 없습니다" page |
| 409 `SEQ_OUT_OF_ORDER` / `EVENT_ID_CONFLICT` / 400 on a transition | event dropped (can never succeed), error recorded in `sync.lastError` |
| 409 `SESSION_ENDED` | sync stops, camera released, UI shows ended |
| camera denied / unavailable / track ended | engine → `UNKNOWN`; CameraPanel always shows the status; focus never accrues |
| SSE disconnect | reconnect with backoff; refetch report on every (re)connect |

## Authentication
- `POST /api/v1/auth/login` → HS256 JWT (`sub` = user id, `role`, `iss=study-monitor`, `exp` = 12 h default).
  Secret from `JWT_SECRET` (≥ 32 bytes, server refuses to start otherwise). Never committed.
- Client keeps the token in `sessionStorage` (cleared when the tab closes) and sends
  `Authorization: Bearer`. No cookies → no CSRF surface. SSE uses fetch streaming with the same header
  (no tokens in URLs or access logs).
- Passwords: BCrypt. Demo accounts only via `SEED_DEMO_DATA=true` (dev).

## CORS
- Allowed origins from `CORS_ALLOWED_ORIGINS` (comma-separated; default `http://localhost:3000`).
- Methods `GET, POST, OPTIONS`; headers `Authorization, Content-Type, Accept`; no credentials (cookies) needed.
