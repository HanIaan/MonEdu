# Known technical limitations (MVP)

Measured results are filled in from actual runs (see "Measurements"); anything not yet measured is
marked as such.

## Detection is estimation, not proof
- **Focus** = "present in front of the camera without sustained phone evidence". It does not measure
  attention, comprehension or whether the student is actually studying.
- **Phone** = COCO `cell phone` *object* detected (EfficientDet-Lite0) near a present student for 20 s.
  Small, dark, edge-on or hand-occluded phones are often missed; remotes, calculators and dark
  rectangles can be false positives. It never proves *use*.
- **Pets read as present:** BlazeFace detected cat/dog faces at 0.71–0.79 (≥ presenceMinScore 0.6) on
  MediaPipe's `cats_and_dogs.jpg` (measured 2026-11-03). A pet alone in frame can keep the state
  FOCUS_ESTIMATED / prevent AWAY. (Not mitigated in v1; a future fix could require the object
  detector's `person` class or shoulders for presence.)
- **Phone at 320×240:** on W1's still-image check a clearly visible phone scored 0.64 at full resolution
  but 0.45 at 320×240 (< phoneMinScore 0.5) — the low-res camera setting trades phone recall for CPU.
  See `frontend/public/models/README.md` → Verification.
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
- Turbopack additionally emits the raw `vision.worker.ts` source as an unused static asset
  (no secrets; harmless). Inference runs in a module Worker; if it cannot start the pipeline falls back
  to the main thread (measured by W1: 404 → 1.3 s, hang → 5.3 s).
- Requires a browser with `getUserMedia`, WebAssembly and (preferably) module Workers + `ImageBitmap`.
  Tested with Chromium (Playwright). Safari/Firefox not verified in this MVP.
- Camera access requires a secure context (HTTPS or `localhost`).
- One active session per student; opening the study page in a second tab replaces the first session.

## Security / ops (MVP scope)
- JWT stored in `sessionStorage` (XSS would expose it; no refresh tokens; 12 h expiry).
- SSE fan-out is in-memory (single backend instance). Horizontal scaling needs a shared pub/sub.
- No rate limiting, account management UI, password reset, or audit log UI.

## Measurements (2026-11-03, Apple Silicon, Playwright 1.64.1)

### Hidden analysis video — frame delivery (`tests/e2e/fixtures/video-visibility-probe.html`)
Same MediaStream into 6 differently hidden `<video>` elements, 6 s, synthetic 15 fps source.

| Variant | Chromium 156 (headless) | Playwright WebKit 27.2 (headless) |
|---|---|---|
| 2×2 px, opacity 0.01, fixed (**used**) | flowing (rVFC 92) | flowing (rVFC 95) |
| `display:none` | flowing | flowing |
| detached from DOM | flowing | flowing |
| `visibility:hidden` | flowing | flowing |
| offscreen `left:-9999px` | flowing | flowing |
| visible 160×120 (control) | flowing | flowing |

**Not verified on real Safari.app** (Playwright WebKit lacks Safari's power-saving/autoplay policies).
Open the probe page in Safari (`python3 -m http.server 4800` in `tests/e2e/fixtures`, then
`http://localhost:4800/video-visibility-probe.html` → "실제 카메라로 측정") to check a real device.
Regardless of the result, the engine's freshness check turns a non-delivering video into `UNKNOWN`
rather than counting focus (E2E `frozen camera frames → UNKNOWN`, passing in Chromium and WebKit).

### Frozen-frame signals (measured)
When a live MediaStream stops producing frames, `video.currentTime` keeps advancing (+3.0 s per 3 s)
in both Chromium 156 and WebKit 27.2 while `requestVideoFrameCallback` fires 0 times — hence rVFC is
the authoritative freshness signal.

### Preview hidden vs shown (E2E, Chromium; same in WebKit)
| Cycle | seated → FOCUS | empty → AWAY |
|---|---|---|
| warm-up | 15.8 s | 31.0 s |
| preview hidden | 16.3 s | 32.1 s |
| preview shown | 16.1 s | 31.1 s |
| hidden again | 16.3 s | 30.9 s |
One earlier run showed a 29.4 s first seating; not reproduced in later runs (cause unknown).

### Heartbeat loss (E2E, Chromium)
Student network down → teacher dashboard showed `UNKNOWN` after **80 s** (rule: 90 s since the last
heartbeat, heartbeats every 30 s); on reconnect the client re-asserted `FOCUS_ESTIMATED` (RECONNECTED)
and the queue drained.

### Background tab freezing is unreliable to simulate
CDP `Page.setWebLifecycleState({state:'frozen'})` on a page with an active camera capture did **not**
stop heartbeats immediately (they continued ~1.5 min). Chrome restricts freezing of pages that capture
media, which is consistent with "background execution is not guaranteed either way": the design relies on
heartbeat timeout + frame-freshness stall detection, not on assumptions about tab lifecycle.

### Test-harness pitfalls found (not app defects)
- Chrome Headless Shell rejects `--use-file-for-fake-video-capture` (NotFoundError).
- Playwright WebKit with a granted `camera` permission serves its own dark mock device unless
  `getUserMedia` is overridden on `MediaDevices.prototype`.
- `canvas.captureStream(15)` emits identical frames even when drawing stops; use
  `captureStream(0)` + `requestFrame()` to simulate a frozen camera.

