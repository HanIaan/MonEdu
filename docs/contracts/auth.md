# Accounts, Sign-up, Kakao Login & Invite Codes (contract v1.3)

Owner: C0. Implemented by W2 (backend) and W3 (pages); C0 owns `frontend/src/lib/api/` (token,
refresh, client). Endpoints and shapes are in `openapi.yaml` (tag `auth`, `invites`); this document holds
the rules the shapes cannot express. Decisions confirmed by the user (2026-11-04):
- Anyone may sign up as STUDENT or TEACHER.
- Students link to a teacher with the teacher's invite code.
- Kakao login is included. The user registers the Kakao app; keys go only to env vars.
- No email verification or password reset in v1.3 (needs a mail service; recorded in limitations).

## 1. Accounts
- `users.email` and `users.password_hash` become **nullable** (Kakao-only accounts have neither).
  A password account always has both. Email is lower-cased, unique when present.
- `User.email` in the API becomes `string | null` (required key, nullable value).
- Agreements: sign-up requires `agreements.terms = true` and `agreements.privacy = true`; the server
  stores `terms_agreed_at`, `privacy_agreed_at` and `agreements_version` (= `AGREEMENTS_VERSION`,
  default `2026-11-04`). Seeded demo users keep these columns null.
- Display name: trimmed, 1–30 characters, no control characters.
- **Password policy** (server is authoritative; the UI mirrors it):
  - 8–64 characters, at most 72 UTF-8 bytes (BCrypt limit);
  - at least one letter and one digit;
  - must not contain the email's local part when that part is ≥ 3 characters (case-insensitive);
  - must not be in the server's common-password list (≥ 100 entries, e.g. `password1`, `qwer1234`, `1q2w3e4r`).
  - Violations → 400 `VALIDATION_FAILED`, `errors[].field = "password"`, message in Korean.
- Duplicate email → 409 `EMAIL_TAKEN`.
- No account linking in v1.3: a Kakao login never attaches to an existing password account, even
  with the same email (Kakao email is not requested).

## 2. Tokens and sessions
- **Access token:** the existing HS256 JWT (`sub`, `role`, `iss`, `exp`), now also with a `jti`.
  TTL `JWT_TTL`: production should use `PT15M`; the default stays `PT12H` so existing dev/E2E runs keep working.
  The frontend keeps it **in memory only** (no Web Storage).
- **Refresh token:** 256-bit random, base64url. Only `SHA-256(token)` is stored (`refresh_tokens`).
  - TTL `REFRESH_TTL` (default `P14D`).
  - Sent only as a cookie:
    `sm_rt=<token>; HttpOnly; SameSite=Lax; Path=/api/v1/auth; Max-Age=<ttl>; Secure` (Secure when
    `AUTH_COOKIE_SECURE=true`, the production default; dev `.env` sets false).
- Every response that issues tokens (signup, login, refresh, kakao complete, kakao callback for an
  existing user) sets a new `sm_rt`.
- **Rotation:** `POST /auth/refresh` consumes the presented token (sets `revoked_at`, `replaced_by`) and
  issues a new one in the same `family_id`.
  - **Concurrent tabs:** a token revoked by rotation less than 30 s ago (`REFRESH_REUSE_GRACE`,
    default `PT30S`) is accepted once more and issues a new token in the same family (two tabs refreshing
    at the same moment must not log the user out).
  - Presenting a revoked token outside that grace is **reuse**: the server revokes the whole family and answers 401.
  - Missing, unknown or expired tokens also answer 401. Every 401 clears the cookie.
- **Logout:** `POST /auth/logout` revokes the presented token's family, clears the cookie and returns 204
  (also 204 when no cookie is present).
- CORS: `allowCredentials = true` with the explicit `CORS_ALLOWED_ORIGINS` (never `*`). Methods add `DELETE`
  only if an endpoint needs it (none in v1.3).
- The frontend origin and API must be **same-site** in production (e.g. `app.example.com` +
  `api.example.com`), otherwise SameSite=Lax cookies are not sent. `localhost:3000` → `localhost:8080`
  is same-site.
- Changing nothing for existing callers: `Authorization: Bearer` on all non-auth endpoints, as before.

## 3. Throttling (in-memory, per backend instance — limitation recorded)
| Key | Limit | Response |
|---|---|---|
| login failures per email (known or unknown) | the 5th consecutive failure itself answers 429 and starts a 15-min lock (attempts 1–4 answer 401); success resets | 429 `TOO_MANY_ATTEMPTS` + `Retry-After` (seconds); while locked, even a correct password gets 429 |
| credential requests per client IP (`signup`, `login`, `kakao/start`, `kakao/callback`, `kakao/complete`) | `AUTH_IP_LIMIT_PER_MINUTE` (default 30) / minute | 429 `TOO_MANY_ATTEMPTS` + `Retry-After` |
| `refresh` per client IP (every page load calls it) | `REFRESH_IP_LIMIT_PER_MINUTE` (default 120) / minute | 429 `TOO_MANY_ATTEMPTS` + `Retry-After` |
| invite-code join attempts per student | 10 / 10 minutes | 429 `TOO_MANY_ATTEMPTS` + `Retry-After` |

Client IP = the socket remote address. `X-Forwarded-For` is trusted only when
`TRUSTED_PROXY=true`, and then only its last hop.
E2E/load-test scripts raise both IP limits via env (all their traffic comes from one IP).
The login error for a wrong password and for an unknown email is identical (`BAD_CREDENTIALS`), as before.

## 4. Kakao login (OAuth 2.0 authorization code, server-side)
Config (env only, never committed, never logged):

| Variable | Meaning |
|---|---|
| `KAKAO_REST_API_KEY` | REST API key |
| `KAKAO_CLIENT_SECRET` | client secret, if enabled in the Kakao console |
| `KAKAO_REDIRECT_URI` | must equal the URI registered in the console, e.g. `http://localhost:8080/api/v1/auth/kakao/callback` |
| `FRONTEND_BASE_URL` | e.g. `http://localhost:3000` |
| `KAKAO_AUTH_BASE_URL` | default `https://kauth.kakao.com`; overridable for tests only |
| `KAKAO_API_BASE_URL` | default `https://kapi.kakao.com`; overridable for tests only |

Kakao is **enabled** iff `KAKAO_REST_API_KEY` and `KAKAO_REDIRECT_URI` are set; `GET /auth/providers`
reports it, and `/auth/kakao/*` answer 404 `PROVIDER_DISABLED` otherwise.

Flow:
1. The browser navigates (top-level, not fetch) to `GET /api/v1/auth/kakao/start`.
   - The server creates `state` (128-bit random) and stores it in the cookie
     `sm_oauth=<state>; HttpOnly; SameSite=Lax; Path=/api/v1/auth/kakao; Max-Age=600`.
   - It then answers 302 to `{KAKAO_AUTH_BASE_URL}/oauth/authorize?response_type=code&client_id=…&redirect_uri=…&state=…`.
2. Kakao redirects to `GET /api/v1/auth/kakao/callback?code&state` (or `?error=access_denied…`).
   The server:
   - rejects a `state` that differs from the cookie (constant-time compare), then clears `sm_oauth`;
   - exchanges the code: `POST {AUTH}/oauth/token` (form: `grant_type=authorization_code`, `client_id`,
     `redirect_uri`, `code`, `client_secret` if set; timeout 5 s);
   - reads `GET {API}/v2/user/me` with `Authorization: Bearer <kakao access token>` → `id` (number) and
     `kakao_account.profile.nickname` (optional);
   - discards the Kakao tokens (never stored, never logged).
3. Outcome, always a 302 to the frontend (no tokens in any URL):

| Case | Redirect | Cookie |
|---|---|---|
| identity `(KAKAO, id)` exists | `{FRONTEND}/auth/kakao/done` | new `sm_rt` |
| new identity | `{FRONTEND}/signup/kakao` | `sm_signup=<signed ticket>; HttpOnly; SameSite=Lax; Path=/api/v1/auth/kakao; Max-Age=600` |
| user cancelled (`error=access_denied`) | `{FRONTEND}/login?error=kakao_cancelled` | — |
| state mismatch / Kakao error / timeout | `{FRONTEND}/login?error=kakao_failed` | — |

   The ticket is a JWT (`JWT_SECRET`, `aud=kakao-signup`, 10 min) holding the Kakao id and nickname.
4. `/auth/kakao/done` (frontend) calls `POST /auth/refresh` to obtain the access token.
5. `/signup/kakao` (frontend):
   - calls `GET /auth/kakao/pending` → `{ nickname }` (401 if there is no valid ticket);
   - asks for role, display name (prefilled with the nickname) and the two agreements;
   - calls `POST /auth/kakao/complete`. The server creates the user (email null, password null) and the identity,
     clears `sm_signup`, sets `sm_rt` and returns 201 `LoginResponse`.
   - If the identity was created meanwhile, it logs in to that account (idempotent).

Only the Kakao numeric id (as text) and the user-entered display name are stored. No Kakao profile image,
email or Kakao token is stored.

## 5. Invite codes
- A teacher has at most one **active** code: 8 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no
  0/O/1/I/L), generated with `SecureRandom`, unique among all codes ever issued.
- Input is normalised: upper-cased, spaces and `-` removed.
- `GET /teacher/invite-code` returns the active code, creating one if none exists.
  `POST /teacher/invite-code/rotate` revokes it and issues a new one; existing links are kept.
- `POST /me/teachers {inviteCode}` (STUDENT only):
  - an active code links the student to that teacher (`teacher_students`) and returns 200 `TeacherLink`;
    if they are already linked, it returns 200 with the existing link;
  - an unknown or revoked code returns 404 `INVITE_CODE_INVALID`.
  - A student may link to several teachers.
- `GET /me/teachers` lists the student's teachers (oldest first).
- After a link is created, the teacher must see the student without logging in again: overview queries
  read `teacher_students` on every request, and the teacher SSE stream must deliver events for students
  linked after the stream was opened.
- Unlinking is not part of v1.3 (limitation).

## 6. Demo data
- `SEED_DEMO_DATA` stays `false` by default (production). The E2E/dev scripts set it explicitly.
- The login page shows the demo-account hint only when `NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS=1`.

## 7. Account deletion (v1.3, user-approved 2026-11-04)
- `DELETE /api/v1/me` with `DeleteAccountRequest` — any signed-in STUDENT or TEACHER.
- Password accounts must send the current password (wrong/missing → 400 `VALIDATION_FAILED`,
  field `password`). Failures share the login lock (§3: 5 failures → 429 for 15 min). Kakao-only
  accounts send `confirm: true` only. `confirm` must be `true` for everyone (field `confirm`).
- One transaction deletes the account and everything it owns: `activity_intervals`,
  `monitoring_events`, `study_sessions` (student), `teacher_invite_codes` (teacher), every
  `teacher_students` row on either side, `refresh_tokens`, `user_identities`, then `users`.
  Other accounts are untouched (a deleted teacher's students simply lose the link).
- Response 204 clears `sm_rt`. Outstanding access tokens fail on `GET /me` (401); the client
  signs out locally right away. The email may be used again for a new account.
- Not done: Kakao "unlink" on Kakao's side (needs the user's Kakao access token, which the server
  does not keep) — logging in with Kakao again starts a fresh sign-up. No grace period / undo.
