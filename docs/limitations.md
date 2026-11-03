# Known technical limitations (MVP + Phase 2)

Measured results are filled in from actual runs (see "Measurements"); anything not yet measured is
marked as such.

## Detection is estimation, not proof
- **Focus** = "present in front of the camera without sustained phone evidence". It does not measure
  attention, comprehension or whether the student is actually studying.
- **Phone** = COCO `cell phone` *object* detected (EfficientDet-Lite0) near a present student for 20 s.
  Small, dark, edge-on or hand-occluded phones are often missed; remotes, calculators and dark
  rectangles can be false positives. It never proves *use*.
- **Pets (mitigated in v1.2):** v1 read cat/dog faces as present (BlazeFace 0.71–0.79). Presence now
  also requires a COCO `person` detection (state-machine.md §2). Measured per frame: pets PRESENT
  27/100 → 0/100, empty scenes 6/60 → 0/60 (W1 bench §B); E2E `pets only → never FOCUS` passes.
  Remaining: a **person photo/poster** on the wall can still read as present (person + face).
- **Phone recall is limited** (v1.2: camera 640×480, EfficientDet-Lite0 int8, threshold 0.5 unchanged):
  COCO recall 0.31 → 0.38 at precision 1.00 (0/150 false positives incl. 75 hard negatives); medium
  phones 0.37 → 0.50, phones < 0.5 % of the frame ≈ 0.03. Commons phone-in-hand photos 6/11.
  Borderline phones scoring 0.45–0.52 per frame mostly do **not** trigger suspicion. Lite2 would raise
  recall to 0.51 at 3× detector cost (+39 MB wasm) — not shipped. Test sets are COCO/Commons stills,
  not real study-room webcam video (`frontend/bench/vision/RESULTS.md` §A, test-set limits).
- **Sleep / eyes closed are NOT detected.** Head-on-desk sleeping and head-down writing give the same
  signals with the current models; eyes-closed needs a new model (Face Landmarker blendshapes) plus
  labelled temporal data. Research only (bench §C); nothing shipped.
- **Presence** = person detection + (face or shoulders or strong person score), so head-down writing
  is not "away" (COCO face-hidden people 41/43 PRESENT); a student far from the camera or out of frame
  laterally may read as absent. If the object detector fails, face/shoulders alone become UNCERTAIN →
  UNKNOWN (safe, but no focus is counted).
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
  (no secrets; harmless). Inference runs in a classic Worker; if it cannot start the pipeline falls back
  to the main thread (measured by W1: 404 → 1.3 s, hang → 5.3 s).
- **Low-end devices (v1.2 adaptive cadence):** when p95 inference > 40 % of the interval the engine slows
  face/pose and detector cadence (up to 2 s / 4 s). Accounting stays elapsed-time based; transitions are
  emitted up to one interval later and intermittently visible phones are caught less often (CPU-throttle
  emulation 1×/4×/8×: same transitions, +0.7…+2.5 s later). Real low-end hardware was **not** measured.
- Requires a browser with `getUserMedia`, WebAssembly and (preferably) Workers + `ImageBitmap`.
  Automated: Chromium and the Playwright **WebKit engine**. **Real Safari.app, Firefox and real webcams are
  not verified** — see `docs/safari-manual-checklist.md`.
- Camera access requires a secure context (HTTPS or `localhost`).
- One active session per student; opening the study page in a second tab replaces the first session.

## Security / ops (MVP scope)
- JWT stored in `sessionStorage` (XSS would expose it; no refresh tokens; 12 h expiry).
- SSE fan-out is in-memory (single backend instance). Horizontal scaling needs a shared pub/sub.
- Load measured on one shared dev machine (W2, `backend/loadtest/RESULTS.md`): 1,000 simulated students
  + 1,010 SSE connections, 180 s steady state, 0 errors, heartbeat p95 8.5 ms, teacher overview p95
  24 ms. Not measured: >1,000 users, multi-hour load, network latency, a separate DB host.
- Flyway runs with `out-of-order: true` because the demo seed is versioned `V1000`; new schema migrations
  (V2…) must stay additive and monotonically numbered.
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

### Soak (5 min, Chromium headless, preview hidden, canvas camera, real models)
JS heap 12.6 → 13.0 MB (samples every 30 s, max 13.4 MB, no upward trend); JS event listeners 665
constant. Main-thread CPU ≈ 15.8 % of one core (CDP `TaskDuration`). **Worker-thread inference CPU is not
included** in that figure, and headless timings on an Apple Silicon desktop do not represent low-end
laptops. A multi-hour soak and real-webcam CPU profiling were not run.

### Test-harness pitfalls found (not app defects)
- Chrome Headless Shell rejects `--use-file-for-fake-video-capture` (NotFoundError).
- Playwright WebKit with a granted `camera` permission serves its own dark mock device unless
  `getUserMedia` is overridden on `MediaDevices.prototype`.
- `canvas.captureStream(15)` emits identical frames even when drawing stops; use
  `captureStream(0)` + `requestFrame()` to simulate a frozen camera.

