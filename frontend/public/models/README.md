# Vision models (owner: W1)

Served same-origin at `/models/<file>` and loaded by `src/lib/vision` (MediaPipe Tasks Vision
`@mediapipe/tasks-vision@1.2.0`, WASM from `/mediapipe/wasm`, copied by `npm ci` postinstall).
Nothing is fetched from a CDN at runtime. All inference runs in the browser; only coarse scores
(`FrameObservation`) leave the vision layer, and only state transitions leave the browser.

| File | Size (bytes) | sha256 |
|---|---|---|
| `blaze_face_short_range.tflite` | 229 746 | `b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f` |
| `pose_landmarker_lite.task` | 5 777 746 | `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` |
| `efficientdet_lite0.tflite` | 4 602 795 | `0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb` |

Verify: `cd frontend/public/models && shasum -a 256 *.tflite *.task`

## 1. Face Detector — BlazeFace short range (float16)

- Source: <https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite>
- Docs: <https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector>
- Model card: <https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20(Short%20Range).pdf>
- License: **Apache License 2.0** — stated under "LICENSED UNDER" in the model card above (checked 2026-11-03).
- Can: detect roughly frontal faces near the camera (card: < 2 m, face box ≥ 20 % of the image side,
  roll/pitch ≤ 45°, yaw ≤ 90°); returns a box, 6 keypoints and a score. We keep **only the best score**.
- Cannot / caveats: faces looking away, strongly tilted (e.g. head down over a notebook), backs of
  heads, small/far faces are missed **by design**. That is why the engine also accepts "upper body
  visible" as presence. No identity / recognition (explicitly out of scope per the card).

## 2. Pose Landmarker — BlazePose GHUM lite (float16)

- Source: <https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task>
  (a zip of `pose_detector.tflite` + `pose_landmarks_detector.tflite`)
- Docs: <https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker>
- Model card: <https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf>
- License: **Apache License 2.0** — stated under "LICENSED UNDER" in the model card above (checked 2026-11-03).
- Can: 33 body landmarks for **one** person with per-landmark `visibility`. We keep only
  `min(visibility(left shoulder #11), visibility(right shoulder #12))` → `poseScore`, and
  `upperBodyDetected = poseScore ≥ poseMinVisibility`.
- Cannot / caveats: tracks a single person (card: multiple people out of scope); degrades with
  people > 4 m away, poor light, heavy occlusion. Visibility is a model estimate, not ground truth.
  Runs in VIDEO mode (tracking between frames).

## 3. Object Detector — EfficientDet-Lite0 (int8, COCO)

- Source: <https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite>
- Docs: <https://ai.google.dev/edge/mediapipe/solutions/vision/object_detector> (no separate model card is linked there)
- License: **not stated** on the MediaPipe object-detector page and the `.tflite` carries no license
  metadata (checked with `strings`). The upstream EfficientDet-Lite checkpoints come from
  <https://github.com/google/automl/tree/master/efficientdet>, whose `LICENSE` is **Apache License 2.0**
  (checked 2026-11-03). Treat "Apache-2.0 via upstream" as the best available information, not as an
  explicit statement for this exact file.
- Can: 80 COCO classes, 320×320 input. We restrict it with `categoryAllowlist: ['cell phone']`,
  `scoreThreshold: 0.2`, `maxResults: 3`, and keep only the best `cell phone` score.
- **Cannot:** it detects a phone-shaped *object* in view. It does **not** detect phone *use*,
  attention, or what is on the screen. A phone lying on the desk is a "phone"; a phone held below the
  desk is invisible. Small, partially occluded, dark-cased or edge-on phones are frequently missed
  (see verification: 4 clearly visible phones in `phone_overuse.jpg` scored 0). Scores near the 0.5
  threshold flip with resolution (0.64 at 960 px vs 0.45 at 320 px for the same photo). Hence the
  engine only reports `DISTRACTION_SUSPECTED` after 20 s of continuous evidence with hysteresis, and
  the UI must present it as a *suspicion*.

## Runtime notes (verified, see below)

- **Production / `next dev` (Turbopack, Next 16.4): the worker is a CLASSIC worker.** Turbopack
  compiles `new Worker(new URL('./vision.worker.ts', import.meta.url))` into
  `static/chunks/turbopack-worker-*.js`, a bootstrap that loads the worker chunks with
  `importScripts` — that throws in a `{ type: 'module' }` worker, so the factory must not pass
  `type: 'module'`. (A raw `static/media/vision.worker.<hash>.ts` is also emitted for the `new URL()`
  asset reference; it is never executed.) The worker detects classic vs module at runtime
  (`importScripts()` with no args throws only in module workers) and picks MediaPipe's classic loader
  (`vision_wasm_internal.js`, re-executed per task by `importScripts`) or the ES-module loader.
  Using the module loader in a classic worker fails with `Cannot use import.meta outside a module`.
- Fallback: the worker posts `ready` on start. If it does not arrive within 4 s, or the worker fires
  `error` (e.g. 404 / bootstrap failure), the pipeline switches to the main thread; the 30 s timeout
  only applies to model loading inside a worker that did start.
- In a **module worker** (other ESM bundlers / the verification harness), tasks-vision's `importScripts` throws `TypeError`, so it loads the WASM
  loader via `self.import(url)`. The worker therefore uses `FilesetResolver.forVisionTasks(base, true)`
  (`vision_wasm_module_internal.js`, which sets `globalThis.ModuleFactory`) and provides a
  `self.import` that re-sets `ModuleFactory` from the module's default export — the bundle clears
  `self.ModuleFactory` after each task, and a cached ES module does not re-run, so without this the
  2nd and 3rd model fail with `ModuleFactory not set.` (observed, then fixed).
- VIDEO-mode timestamps must be small: epoch-ms timestamps are saturated to int32 by tasks-vision
  (`Packet timestamp mismatch … 2147483647000`), which permanently broke the pose/object graphs in the
  first end-to-end run. The runner uses ms since its first frame (fixed, re-verified).
- Delegate: CPU (XNNPACK). The graph runner still needs an `OffscreenCanvas` in a worker; where that
  is missing (e.g. Safari < 17) worker init fails and the pipeline falls back to the main thread.

## Verification

Date: **2026-11-03**, macOS (Apple Silicon), Playwright 1.64.1 headless Chromium
`HeadlessChrome/156.0.8078.4`, `@mediapipe/tasks-vision` 1.2.0 `vision_bundle.mjs` + `wasm/` from
`frontend/node_modules`, the three model files above. Everything ran in a temporary directory outside
the repo (`$SCR` = session scratchpad); nothing from it is committed.

Harness: the **production code** (`src/lib/vision/vision.worker.ts`, `mediapipeRunner.ts`,
`pipelines.ts`, and for the e2e run `src/features/monitoring/engine`) bundled with the repo's
`rolldown` (`@mediapipe/tasks-vision` kept external and mapped to `./vision_bundle.mjs`), served by a
20-line Node static server with the same paths as production (`/mediapipe/wasm`, `/models`).

```bash
# in $SCR/verify: site/ = vision_bundle.mjs, mediapipe/wasm/, models/, images/, index.html, e2e.html
node tools/build.mjs     <frontend> site tools   # worker.js + main.js (still-image harness)
node tools/build-e2e.mjs <frontend> site tools   # e2e.js (real MonitoringController)
node tools/server.mjs site 4777 &
node tools/run.mjs pw                            # still images, main thread + module worker
node tools/run-e2e.mjs pw cam/person.mjpeg       # fake camera fed from a test photo
```

Test images (Wikimedia Commons, 960 px thumbnails; none committed):
`phone_smiling_woman.jpg` = "Smiling woman with a phone (Unsplash).jpg" (CC0) ·
`phone_overuse.jpg` = "Mobile phone overuse.jpg" (CC0, 4 people with phones) ·
`phone_ranger.jpg` = "Ranger Nico Using Phone for iNaturalist (51984949226).jpg" (public domain) ·
`desk_dryden.jpg` = "Dr. Hugh L. Dryden seated at desk (4940324481).jpg" (NASA, no restrictions) ·
`portrait_leather.jpg` = "Young woman in leather jacket (Unsplash).jpg" (CC0) ·
`empty_bookstand.jpg` = "Bookstand with desk lamp.jpg" (public domain, no person) ·
`black` = synthetic 320×240 black canvas.

### Still images (object detector run on every frame)

`@320` = downscaled to fit 320×240 (the camera resolution we request). Scores are identical on the
main thread and in the module worker (transferred `ImageBitmap`), so one column is shown; ms =
main / worker wall time per frame including the frame-quality check.

| Image | quality | face | shoulders (poseScore) | upper body | phone | phone ≥ 0.5 | ms main / worker |
|---|---|---|---|---|---|---|---|
| phone_smiling_woman @orig | OK | 0.91 | 1.00 | yes | 0.64 | yes | 205 / 188 (first frame) |
| phone_smiling_woman @320 | OK | 0.91 | 1.00 | yes | 0.45 | **no** | 62 / 60 |
| phone_overuse @orig | OK | 0.40 | 1.00 | yes | 0.00 | **no** (4 phones visible) | 69 / 60 |
| phone_overuse @320 | OK | 0.52 | 1.00 | yes | 0.00 | **no** | 60 / 58 |
| phone_ranger @orig | OK | 0.70 | 1.00 | yes | 0.00 | **no** | 88 / 69 |
| phone_ranger @320 | OK | 0.75 | 1.00 | yes | 0.52 | yes | 61 / 59 |
| desk_dryden @orig | OK | 0.51 | 1.00 | yes | 0.00 | no | 80 / 69 |
| desk_dryden @320 | OK | 0.63 | 1.00 | yes | 0.00 | no | 60 / 59 |
| portrait_leather @orig | OK | 0.79 | 1.00 | yes | 0.00 | no | 67 / 62 |
| portrait_leather @320 | OK | 0.75 | 0.00 | no | 0.00 | no | 59 / 57 |
| empty_bookstand @orig | OK | 0.00 | 0.00 | no | 0.00 | no | 67 / 59 |
| empty_bookstand @320 | OK | 0.00 | 0.00 | no | 0.00 | no | 56 / 55 |
| black @320 | **LOW** | – | – | – | – | – | 0 (models skipped) |

Model load (3 models): 287 ms main thread (ran first, cold), 200 ms worker (ran second; HTTP cache likely warm).
Worker loop, 40 frames of desk_dryden @320 at 500 ms spacing (phone every 2nd frame): avg 35 ms,
max 69 ms per frame; fed into `createStateMachine()` → one `SEATED_CONFIRMED` with `detectedAt` = first frame.

Caveat: the stills were fed in VIDEO mode as one sequence, so pose *tracking* carries between
unrelated photos; `poseScore` values (all ≈1.00, and 0.00 for portrait_leather @320) are therefore
not independent per image. Face scores of 0.40–0.63 for real, clearly visible faces show why presence
must not depend on the face detector alone.

### End-to-end (real `MonitoringController`, real `getUserMedia`)

Chromium flags `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream
--use-file-for-fake-video-capture=person.mjpeg` (phone_smiling_woman resized to 320×240, repeated).
`createMonitoringController()` → `start(video)` → 20 s → `dispose()`:

- camera `active`, track settings 320×240; `inferenceBackend: "WORKER"` (no fallback needed)
- 40 frames processed, 0 skipped, avg inference 41.6 ms
- transitions: exactly one, `UNKNOWN → FOCUS_ESTIMATED (SEATED_CONFIRMED)`, `detectedAt` = first
  processed frame (433 ms after start), signals `{faceScore 0.93, poseScore 1, phoneScore 0.41}`
- after `dispose()`: track `readyState = "ended"`, `video.srcObject = null`; no console errors.

### Next.js integration (2026-11-03, W1-FIX-WORKER)

Throwaway worktree of `agent/claude-coordinator` (879d409) + this branch merged, outside the repo;
`npm ci && npm run build` (Next 16.4.4 Turbopack), served with `next start` (and `next dev`), headless
Chromium 156 with a fake camera (`person.mjpeg`):

- `next build` + `next start`, throwaway `/wcheck` page using the production factories:
  `createVisionPipeline().load()` → `backend: "WORKER"`, `workerError: null`, real observation
  (face 0.91, shoulders 1.00, phone 0.45); `createMonitoringController()` → `inferenceBackend: "WORKER"`,
  34 frames, 0 skipped, avg 48.8 ms, `UNKNOWN→FOCUS_ESTIMATED (SEATED_CONFIRMED)`; worker URL
  `/_next/static/chunks/turbopack-worker-*.js`; no console errors.
- `next dev`: same page, same result (`WORKER`, SEATED_CONFIRMED, no `[vision]` fallback warning).
- Real `/student` page (built with `NEXT_PUBLIC_API_BASE_URL` → an isolated backend + Postgres with
  demo seed): login `student1@demo.local` → consent → start → one Turbopack worker, no fallback
  warning, `POST …/transitions {FOCUS_ESTIMATED, SEATED_CONFIRMED}` after ~15 s.
- Forced worker failure via request interception: worker script 404 → `MAIN_THREAD` after
  1.3 s total (including main-thread model load); worker script never delivered → `MAIN_THREAD`
  after 5.3 s (4 s start timeout + load); seating still confirmed in both.
- Before the fix (C0 evidence + reproduction): module worker → bootstrap `importScripts` throws, or
  (dev) classic worker + ES-module loader → `Cannot use import.meta outside a module`; both fell back
  to `MAIN_THREAD`.

Not verified: real webcams / real rooms, Safari and Firefox, low-end devices, GPU delegate,
long-running memory behaviour, background-tab throttling in a real browser (covered only by unit
tests with fake timers).
