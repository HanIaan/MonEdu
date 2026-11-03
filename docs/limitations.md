# Known technical limitations (MVP)

Measured results are filled in from actual runs (see "Measurements"); anything not yet measured is
marked as such.

## Detection is estimation, not proof
- **Focus** = "present in front of the camera without sustained phone evidence". It does not measure
  attention, comprehension or whether the student is actually studying.
- **Phone** = COCO `cell phone` *object* detected (EfficientDet-Lite0) near a present student for 20 s.
  Small, dark, edge-on or hand-occluded phones are often missed; remotes, calculators and dark
  rectangles can be false positives. It never proves *use*.
- **Presence** uses face **or** shoulders, so head-down writing is not "away"; a student far from the
  camera or out of frame laterally may read as absent.
- Lighting: very dark frames are classified `LOW` quality → `UNKNOWN` rather than guessed.
- No identity verification: the system cannot tell *who* is in front of the camera (by design — no
  face embeddings are computed or stored).

## Browser background execution is NOT guaranteed
- Browsers throttle timers in hidden tabs (Chrome: ≥ 1 s, then "intensive throttling" ≈ 1/min after
  5 min hidden), may pause `requestVideoFrameCallback`, and can **freeze or discard** background tabs
  (memory saver, mobile, laptop sleep).
- Design response: the engine detects stalls (no processed frame > 5 s → `UNKNOWN`/`INFERENCE_STALLED`,
  back-dated to the last frame) and the server marks `UNKNOWN` at `verifiedUntil` after 90 s without
  heartbeat. Unverified time is never counted as focus.
- Students should keep the study tab visible (a separate window is fine) for continuous measurement.

## Time & accounting
- Client `detectedAt` is trusted only within bounds: never in the future (+5 s), never before the current
  interval. A client could still under-report (e.g. delay a transition) — the server cannot see video.
- Intervals are attributed to the session's study date (Asia/Seoul); sessions crossing midnight are not
  split in v1.
- Live "open interval" totals are approximate until the next transition or heartbeat (≤ 45 s grace).

## Platform
- Requires a browser with `getUserMedia`, WebAssembly and (preferably) module Workers + `ImageBitmap`.
  Tested with Chromium (Playwright). Safari/Firefox not verified in this MVP.
- Camera access requires a secure context (HTTPS or `localhost`).
- One active session per student; opening the study page in a second tab replaces the first session.

## Security / ops (MVP scope)
- JWT stored in `sessionStorage` (XSS would expose it; no refresh tokens; 12 h expiry).
- SSE fan-out is in-memory (single backend instance). Horizontal scaling needs a shared pub/sub.
- No rate limiting, account management UI, password reset, or audit log UI.

## Measurements
_Filled in after Phase 3 validation._
