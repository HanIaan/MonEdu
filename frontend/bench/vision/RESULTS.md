# Vision benchmark results — P2-W1 (2026-11-03)

Owner: W1. Every number below comes from an actual run of the scripts in this directory unless it is
labelled **ESTIMATE**. Raw outputs (`.cache/results/*.json`, `tables.md`) are gitignored; re-create
them with the commands in [Reproduce](#reproduce).

**Environment (all runs):** macOS, Apple Silicon (darwin arm64), Playwright-core 1.64.1,
`HeadlessChrome/156.0.8078.4`, `@mediapipe/tasks-vision` 1.2.0, CPU delegate (XNNPACK), main thread.
This is a fast desktop. Low-end laptops will be several times slower (see §D for a CPU-throttled
emulation; real low-end hardware was **not** measured).

## Test sets and their limits

| Set | Source | n | Ground truth |
|---|---|---|---|
| `phone_pos` | COCO val2017: largest person ≥ 10 % of image, ≥ 1 `cell phone` box ≥ 0.15 % | 90 (all that qualify) | COCO annotations |
| `phone_neg` | COCO val2017: largest person ≥ 10 %, no `cell phone` annotation; 75 of them contain remote / laptop / keyboard / book / mouse (hard negatives) | 150 | COCO annotations |
| `pets` | COCO val2017: cat or dog ≥ 5 %, no person | 100 | COCO annotations |
| `person_upper` | COCO val2017 + keypoints: person ≥ 15 %, both shoulders visible, a face keypoint visible | 100 | COCO keypoints |
| `face_hidden` | same, shoulders labelled but nose + both eyes NOT labelled (head turned / bowed away — proxy for head-down writing) | 43 (all that qualify) | COCO keypoints |
| `empty` | COCO val2017: no person/animal, contains chair/couch/bed/table/tv/laptop/book | 60 | COCO annotations |
| Commons | 27 hand-picked Wikimedia Commons photos (phone in hand, writing, reading, sleeping on desk, eyes closed, pets on desks, empty desk); 1 cartoon excluded | 27 | W1's visual label after viewing a contact sheet |

Manifests with per-image license/attribution: `manifest.json` (COCO: Flickr URL + license id, licenses
table; annotations CC BY 4.0) and `commons-manifest.json` (Commons page, license, author). Images are
only in `.cache/`.

**Limits.** COCO is not webcam footage: people are often far away, standing, outdoors, in groups;
phones are often tiny (33 / 90 positives cover < 0.5 % of the image). A webcam 50–80 cm from a seated
student shows a much larger face, body and phone, so absolute recall here is pessimistic; the
*relative* ranking of options is what the COCO numbers are for. n = 90 positives gives ± ~10 pp
(95 % CI) on recall. COCO misses some phones in its annotations (a "false positive" can be a real
phone). Stills have no motion blur, sensor noise or temporal correlation. Commons labels are mine and
the set is tiny (11 phone images). No dataset of real study-room webcams was available.

## A. Phone detection

### A1–A5: per-image detection, `phoneMinScore` = 0.5 unchanged

`bench.ts` resamples each image to fit the camera size (as a webcam request would) and runs every
detector on the same frames (IMAGE mode). "320" = fit in 320×240, "640" = fit in 640×480 (≈ the COCO
original). ROI = crop around the pose landmarks 0–22 (head, shoulders, arms, hands) + 25 % margin,
min. 40 % of the frame side, full frame when no pose. Cost = main-thread wall time per call, over all
240 phone_pos ∪ phone_neg images; CPU ms/s = (face + pose) × 2 Hz + detector × 1 Hz.

| Option | P | R | TP | FP | FN | det mean ms | det p95 ms | face+pose mean ms | CPU ms/s |
|---|---|---|---|---|---|---|---|---|---|
| (1) 320×240 · Lite0 int8 (**v1**) | 1.00 | 0.31 | 28 | 0 | 62 | 49.2 | 57.5 | 23.2 | 95.7 |
| (2) 640×480 · Lite0 int8 (**chosen**) | 1.00 | 0.38 | 34 | 0 | 56 | 48.5 | 51.0 | 22.6 | 93.7 |
| (3) split: face/pose @320 + Lite0 @640 | 1.00 | 0.38 | 34 | 0 | 56 | 48.5 | 51.0 | 23.2 | 95.0 + downscale |
| (4a) 320 · Lite0 float16 | 1.00 | 0.29 | 26 | 0 | 64 | 52.4 | 68.8 | 23.2 | 98.9 |
| (4b) 640 · Lite0 float16 | 1.00 | 0.28 | 25 | 0 | 65 | 48.8 | 51.3 | 22.6 | 94.1 |
| (4c) 320 · Lite2 int8 | 0.95 | 0.43 | 39 | 2 | 51 | 144.2 | 147.5 | 23.2 | 190.7 |
| (4d) 640 · Lite2 int8 | 0.98 | 0.51 | 46 | 1 | 44 | 144.8 | 149.2 | 22.6 | 190.0 |
| (4e) 320 · SSD-MobileNetV2 f32 | 1.00 | 0.19 | 17 | 0 | 73 | 38.7 | 52.2 | 23.2 | 85.2 |
| (4f) 640 · SSD-MobileNetV2 f32 | 1.00 | 0.19 | 17 | 0 | 73 | 35.3 | 37.3 | 22.6 | 80.5 |
| (5a) 320 · ROI Lite0 int8 | 0.97 | 0.32 | 29 | 1 | 61 | 48.1 | 50.8 | 23.2 | 94.6 |
| (5b) 640 · ROI Lite0 int8 | 0.95 | 0.42 | 38 | 2 | 52 | 48.2 | 50.0 | 22.6 | 93.4 |
| (5c) split 320 + ROI @640 Lite0 int8 | 0.95 | 0.42 | 38 | 2 | 52 | 48.2 | 50.0 | 23.2 | 94.7 + downscale |
| (5d) 640 · ROI Lite2 int8 | 0.98 | 0.53 | 48 | 1 | 42 | 144.6 | 147.9 | 22.6 | 189.8 |

TN = 150 − FP. Recall by phone size (share of image area) at 0.5:

| Option | < 0.5 % (n=33) | 0.5–2 % (n=30) | ≥ 2 % (n=27) |
|---|---|---|---|
| (1) 320 Lite0 int8 | 0.03 | 0.37 | 0.59 |
| (2) 640 Lite0 int8 | 0.03 | 0.50 | 0.67 |
| (4d) 640 Lite2 int8 | 0.27 | 0.67 | 0.63 |
| (5b) 640 ROI Lite0 | 0.24 | 0.47 | 0.59 |

Threshold sensitivity (context only — **not** changed): Lite0 @320 R/P = 0.53/0.98 @0.3, 0.46/1.00
@0.4, 0.31/1.00 @0.5; @640 0.58/0.95, 0.49/1.00, 0.38/1.00. Hard negatives (remote, laptop, …): 0/75
FP for (1)–(3), 2/75 for ROI Lite0, 1/75 for ROI Lite2.

Commons phone-in-hand photos (n = 11, best phone score ≥ 0.5): Lite0 @320 **5/11**, Lite0 @640 **6/11**,
Lite2 @640 **8/11**. Five of the 11 show only hands + phone (no face).

**Observations.**
- Face, pose and object-detector latency are **independent of the input resolution** (each model
  resizes internally: BlazeFace 128², pose 256², Lite0 320², Lite2 448²). Measured face+pose 23.2 ms
  @320 vs 22.6 ms @640. So the split-resolution option (3) buys nothing over (2): it would only add a
  downscale. Not implemented.
- 640 input helps Lite0 (+6 TP, 0 FP) — likely because the detector then resamples once from a sharper frame instead of twice (not verified);
  the gain is in medium/large phones — the webcam case.
- Lite0 float16 is not better than int8; SSD-MobileNetV2 is cheaper but much worse.
- Lite2 has the best recall (+0.13 over the chosen option, +3 Commons images) at **3× detector cost**
  and +39 MB wasm memory (§A-mem). Not chosen as default: on a device 5× slower than this one the
  detector alone would be ~720 ms per second (**ESTIMATE** = 144.8 ms × 5), which the adaptive cadence
  would answer by slowing every signal. Good candidate for an opt-in "high accuracy" mode later.
- ROI cropping gains small phones (+4 TP) but adds FPs (2/150) and needs a pose; not chosen.

### A-mem: model size and memory

Each model loaded alone in a fresh page (`run-mem.mjs`), wasm memory = sum of the task's
`WebAssembly.Memory` buffers (every MediaPipe task instantiates its own wasm module), JS heap delta
from `performance.memory`, 30 inferences on a 640×480 frame (first excluded).
`measureUserAgentSpecificMemory()` threw SecurityError in headless Chromium 156 even when
cross-origin isolated, so it is not used.

| Model | file bytes | wasm heap MB | JS heap Δ MB | mean ms @320 / @640 |
|---|---|---|---|---|
| BlazeFace short (face) | 229 746 | 19.1 | 3.6–4.1 | 2.1 / 2.1 |
| Pose Landmarker lite | 5 777 746 | 82.4 | 9.2–14.9 | 19.5 / 19.9 |
| EfficientDet-Lite0 int8 (**used**) | 4 602 795 | 47.7 | 12.1 | 51.7 / 51.9 |
| EfficientDet-Lite0 float16 | 7 254 339 | 98.9 | 10.2 | 53.2 / 53.3 |
| EfficientDet-Lite2 int8 | 7 515 971 | 87.2 | 10.4 | 152.3 / 152.6 |
| SSD-MobileNetV2 float32 | 11 316 189 | 68.6 | 14.2 | 37.5 / 38.1 |

Production stack (face + pose + Lite0) ≈ 149 MB of wasm heaps. A 640×480 RGBA frame bitmap is 1.2 MB
vs 0.3 MB at 320×240 (transient, transferred to the worker and closed each tick).

### A6: temporal smoothing / behaviour latency

`analyze.mjs` + `harness/sim.ts` drive the **real state machine**: a seated student, phone appears at
t = 0 and stays 60 s; each phone evaluation draws one of 8 measured scores of camera-like perturbations
(crop 90–100 %, shift, brightness ±15 %, 1 px blur 30 %) of that image (5 seeds/image).
Latency = DISTRACTION_SUSPECTED − phone appearance. Draws are independent — **optimistic** for phones
that are only sometimes visible, because real frames are correlated.

| Config | Rule | Cadence face/pose, phone | per-frame det. rate | suspected ≤ 60 s | latency median | latency p95 | false suspicion per 60 s (neg) |
|---|---|---|---|---|---|---|---|
| 320 Lite0 | state machine (20 s + 3 s debounce) | 500 / 1000 ms | 0.33 | 0.33 | 20.0 s | 33.0 s | 0.000 |
| 320 Lite0 | + 2-of-3 pre-filter | 500 / 1000 ms | 0.33 | 0.32 | 21.0 s | 27.0 s | 0.000 |
| 320 Lite0 | + 3-of-5 pre-filter | 500 / 1000 ms | 0.33 | 0.32 | 22.0 s | 29.0 s | 0.000 |
| 640 Lite0 | state machine | 500 / 1000 ms | 0.34 | 0.34 | 20.0 s | 36.0 s | 0.000 |
| 640 Lite0 | state machine | 1000 / 2000 ms | 0.34 | 0.34 | 20.0 s | 48.0 s | 0.000 |
| 640 Lite0 | state machine | 2000 / 4000 ms | 0.34 | 0.35 | 20.0 s | 48.0 s | 0.000 |
| 640 Lite0 | + 2-of-3 pre-filter | 500 / 1000 ms | 0.34 | 0.34 | 21.0 s | 43.0 s | 0.000 |
| 640 ROI Lite0 | state machine | 500 / 1000 ms | 0.36 | 0.35 | 20.0 s | 41.0 s | 0.001 |
| 640 Lite2 | state machine | 500 / 1000 ms | 0.49 | 0.50 | 20.0 s | 33.0 s | 0.007 |

(full table incl. all cadences: `.cache/results/tables.md`.) The existing 20 s run + 3 s hysteresis
already *is* the temporal filter: zero false suspicions for Lite0, and a k-of-n pre-filter only adds
1–2 s latency without reducing anything. **No extra smoothing shipped.** Detection is all-or-nothing
per image: a phone the detector scores ≥ 0.5 in most frames is caught; one that hovers around 0.45–0.52
mostly is not (see e2e below).

**End-to-end with the real `MonitoringController`** (`run-e2e.mjs`: real models, main-thread pipeline,
canvas camera honouring the requested resolution, scene = reading person → phone-holding person at
t = 20 s): `Texting on cell phone.jpg` (commons_08) → PHONE_SUSPECTED emitted at 41.2 s (@320) / 41.1 s
(@640), i.e. **21.1 s after the phone appeared**, `detectedAt` = 21.0 s (back-dated onset). commons_04:
41.0 s / 40.3 s. commons_09 (portrait image, phone cropped by the 4:3 "cover" fit): no suspicion in 40 s.
`Smiling woman with a phone` (commons_00, still score 0.45/0.55): per-frame scores 0.48/0.52 @640 and
0.39–0.48 @320 → **no** suspicion in 50 s at either resolution (borderline phones are not fixed by
resolution alone). Average inference per tick 41.0 ms @320 vs 42.2 ms @640 (p95 69.9 / 69.1 ms).

### A decision

**Camera 640×480, EfficientDet-Lite0 int8 on the full frame, existing state-machine smoothing.**
+7 pp recall on COCO (0.31 → 0.38, 0.50 vs 0.37 for medium phones), +1/11 on Commons, no new FPs,
same models, ~+1.2 ms per tick measured end-to-end. It needs `DEFAULT_ENGINE_CONFIG.camera` = 640×480 →
CONTRACT_CHANGE_REQUEST (W1 did not edit `contracts.ts`; with the current 320×240 default the shipped
code behaves exactly as option (1)). Not measured: camera capture/decode CPU at 640×480 vs 320×240
in a real browser with a real webcam (**ESTIMATE**: higher, small vs inference).

Also fixed: `TransitionSignals.phoneScore/phoneDetected` came from the last *observation*, which on
PHONE_SUSPECTED was often a face/pose-only tick → `phoneScore: 0` was sent with the suspicion. They now
come from the last object-detector tick (unit test + e2e: 0 → 0.55).

## B. Presence: rejecting pets, keeping head-down students

Features per subset @320 (Lite0 person score):

| Subset | n | face ≥ 0.6 | shoulders ≥ 0.5 | person ≥ 0.5 | face median | person median |
|---|---|---|---|---|---|---|
| person_upper | 100 | 0.54 | 0.95 | 0.99 | 0.63 | 0.86 |
| face_hidden | 43 | 0.07 | 0.56 | 1.00 | 0.32 | 0.86 |
| pets | 100 | 0.14 | **0.15** | **0.00** | 0.36 | 0.07 |
| empty | 60 | 0.07 | 0.03 | 0.03 | 0.30 | 0.08 |

Pose Landmarker reports "both shoulders visible" on 15 % of pet photos (also on 2 of 3 Commons cats),
so shoulders are not human evidence either. The COCO `person` class separates people from pets almost
perfectly. Rule candidates were compared on these sets; the chosen one (R4) is implemented in
`engine/stateMachine.ts` `classifyFrame`:

> **PRESENT** ⇔ person detected (score ≥ 0.5, held ≤ 5 s between object-detector ticks) **and**
> (both shoulders visible **or** face ≥ `presenceMinScore` **or** person score ≥ 0.7).
> **ABSENT** ⇔ face < `absentMaxScore`, shoulders not visible, and the *current* frame has no person
> detection. Everything else **UNCERTAIN** (→ UNKNOWN after 10 s), including a face or shoulders
> without a person detection.

Before (v1: face ≥ 0.6 or shoulders) → after (v1.2, real `classifyFrame` on measured scores), per frame,
PRESENT / UNCERTAIN / ABSENT:

| Subset | n | expected | before @320 | after @320 | before @640 | after @640 |
|---|---|---|---|---|---|---|
| person_upper | 100 | PRESENT | 98/2/0 | 99/1/0 | 98/2/0 | 99/1/0 |
| face_hidden | 43 | PRESENT | 26/10/7 | **41/2/0** | 24/12/7 | **40/3/0** |
| phone_pos (people) | 90 | PRESENT | 69/13/8 | 76/11/3 | 64/16/10 | 74/12/4 |
| phone_neg (people) | 150 | PRESENT | 124/14/12 | 132/16/2 | 125/18/7 | 133/15/2 |
| pets | 100 | not PRESENT | **27**/40/33 | **0**/67/33 | **15**/44/41 | **0**/60/40 |
| empty | 60 | not PRESENT | 6/24/30 | 0/31/29 | 7/22/31 | 0/30/30 |
| Commons phone in hand | 11 | PRESENT | 6/4/1 | 11/0/0 | 6/4/1 | 11/0/0 |
| Commons head-down writing | 3 | PRESENT | 1/1/1 | 3/0/0 | 1/1/1 | 3/0/0 |
| Commons reading seated | 3 | PRESENT | 3/0/0 | 3/0/0 | 3/0/0 | 3/0/0 |
| Commons pets on desk | 3 | not PRESENT | 3/0/0 | 0/3/0 | 1/1/1 | 0/2/1 |
| Commons empty desk | 1 | not PRESENT | 0/0/1 | 0/0/1 | 0/0/1 | 0/0/1 |

Presence TP/FP/FN (PRESENT counted as positive; people subsets person_upper + face_hidden, @320):
before TP 124, FN 19, FP (pets + empty) 33 → after TP 140, FN 3, FP 0.

E2E (real controller, 640×480): MediaPipe `cats_and_dogs.jpg` (the image from `docs/limitations.md`)
for 40 s → face up to 0.76, person 0.00, **no transition, state stays UNKNOWN** (v1 confirmed seating).
C0's fixtures still work: `person.jpg` → SEATED_CONFIRMED (emitted 15.8 s @320 / 15.2 s @640),
`nobody.jpg` → PRESENCE_LOST, at both resolutions.

Temporal consistency: the object detector runs at the phone cadence (1 s; up to 4 s in low-power
mode), so person evidence is held ≤ 5 s and only corroborates the face/shoulders of the current frame;
the 15 s seating run + 3 s hysteresis provide the rest. If the object detector stops reporting (model
error, old producer), face + shoulders alone become UNCERTAIN → UNKNOWN (LOW_CONFIDENCE) — by design.
Locked by unit tests in `engine/stateMachine.test.ts` ("v1.2 presence rule").

Remaining limits: a person photo/poster on the wall can still read as present (person + face); a
student fully out of frame except hands is PRESENT only if the person score ≥ 0.7 (Commons hands-only
photos: 0.75–0.95).

## C. Sleep / real attention — research only (nothing shipped)

Small experiment on the Commons set (n per row in brackets) with the current models plus Face
Landmarker (`face_landmarker.task` float16, 3 758 596 bytes, blendshapes; research only, not
added to `public/models`). Face Landmarker found a face in only 6/27 images @320 (9/27 @640) — only
near-frontal faces; mean 6.7 ms, p95 11.9 ms per call.

| Situation | Distinguishable now? | Signal (measured) | Needs new model / data? | Evidence |
|---|---|---|---|---|
| Normal reading, seated (3) | yes, as "present" | shoulders ≈ 1.0, person 0.57–0.80; face 0.30–0.64 | no | Commons reading_seated 3/3 PRESENT |
| Head-down writing (3 + 43 COCO face_hidden) | yes, as "present" — but **not** distinguishable from head on desk | face low (0–0.39), shoulders and/or person ≥ 0.75 | no (for presence) | 3/3 and 41/43 PRESENT with v1.2 rule |
| Looking at phone (11) | only when the phone is visible to the detector | Lite0 phone ≥ 0.5 in 6/11 @640; hands-only frames have no face | better phone detector (Lite2 8/11) | §A |
| Head on desk, sleeping (3: 1 painting, 2 photos) | **no** | same signals as head-down writing: face 0–0.75, shoulders 0–0.99, person 0.17–0.61 → 1 PRESENT / 1 UNCERTAIN / 1 ABSENT | yes: posture model (head height vs shoulders over time) trained/validated on desk-sleeping vs writing video; no such labelled data available | Commons head_on_desk_sleeping |
| Eyes closed while seated (2) | **no** with BlazeFace/pose (face 0.91–0.94, looks like attentive) | Face Landmarker eyeBlink L/R 0.71/0.66 and 0.67/0.79 vs open-eyed frontal faces 0.17/0.15, 0.20/0.12 — but a person **looking down at a phone** scored 0.56/0.40 and the sleeping painting 0.49/0.59 | yes: Face Landmarker (eyeBlink* blendshapes, +3.8 MB, +~7 ms/frame here) **plus** a temporal rule (eyes closed for N s while head not pitched down) validated on labelled video; blink ≠ sleep, downward gaze mimics closed eyes | Commons eyes_closed_seated; commons_08 |
| Leaving the camera | yes | no face, no shoulders, no person → ABSENT → AWAY after 30 s | no | e2e `nobody.jpg`, commons empty desk → PRESENCE_LOST, onset back-dated |

Conclusion: with the current models, sleeping at the desk and head-down writing are the same signal
pattern, and eyes-closed requires a new model plus labelled temporal data. Shipping any sleep detection
would be unverified → not shipped (Phase 2 decision). Face Landmarker pitch from the transformation
matrix was recorded (−8 … +29°) but its sign convention was not verified.

## D. Adaptive cadence (engine/adaptiveCadence.ts, controller.ts)

- Measures the wall time of every `analyze()` (bitmap + transfer + models); p95 over the last ≤ 100.
- Never overlaps inferences (busy ticks → `framesSkipped`); ticks without a new video frame and
  results of a torn-down run → `framesDropped`.
- Slows down when p95 (≥ 20 samples at the current level) > 40 % of the current interval, jumping to
  the first level that fits: multipliers 1, 1.5, 2, 3, 4 of `inferenceIntervalMs` / `phoneIntervalMs`,
  capped at 2 s / 4 s (far from `staleFrameMs` = 5 s). Recovers one level at a time when p95 of the
  last 20 samples < 25 % of the next faster interval and ≥ 10 s at the level (hysteresis, no oscillation
  — unit-tested). A slow warm-up frame or rare outliers do not trigger it.
- Populates `perf.p95InferenceMs / effectiveIntervalMs / effectivePhoneIntervalMs / lowPower /
  framesDropped` (v1.2) and `lastReason`. `dispose()` cancels timers, rVFC, worker/models (unit-tested
  with fake timers while slowed down: 0 timers left).

Low-end emulation (real controller, real models on the main thread, CDP
`Emulation.setCPUThrottlingRate`, 640×480; scene: reading person → phone person at 30 s → empty desk at
75 s):

| CPU throttle | avg / p95 inference | cadence reached | SEATED emitted | PHONE_SUSPECTED emitted (phone at 30 s) | PRESENCE_LOST emitted (left at 75 s) |
|---|---|---|---|---|---|
| 1× | 39.7 / 67.3 ms | 500 / 1000 ms | 15.7 s | 51.2 s (+21.2 s) | 107.0 s (+32.0 s) |
| 4× | 152.4 / 252.4 ms | 750 / 1500 ms (from 14 s) | 16.4 s | 52.7 s (+22.7 s) | 107.7 s (+32.7 s) |
| 8× | 365.0 / 549.5 ms | 1500 / 3000 ms (from 22 s) | 17.2 s | 53.7 s (+23.7 s) | 107.9 s (+32.9 s) |

No `framesSkipped`, no stalls, identical transitions. **How longer intervals affect results:** all
state-machine durations are elapsed time between frame timestamps, so accounting does not change;
`detectedAt` is back-dated to the first evidence frame, which can be up to one interval after the true
event (here ≤ 1.5 s); the transition is *emitted* up to one more interval later. Fewer samples per run
mean the 3 s hysteresis is broken by fewer contrary frames (at a 3 s phone interval, 2 missed detections
instead of 4) — for a phone that is detected intermittently, recall drops (A6 p95 latency 36 → 48 s at
2–4 s phone intervals; the median stays 20 s). Person evidence is held 5 s ≥ the 4 s maximum phone
interval, so presence is unaffected.

## Hand-off for C0's E2E (phone fixture)

`Texting on cell phone.jpg` — <https://commons.wikimedia.org/wiki/File:Texting_on_cell_phone.jpg>,
author Colton Cotton, **CC BY-SA 3.0** (<https://creativecommons.org/licenses/by-sa/3.0>), 509×568.
A person facing the camera holding a phone at chest height. With the chosen config (640×480, Lite0) and
also at 320×240: still scores 0.61 / 0.64, e2e PHONE_SUSPECTED 21.1 s after it appeared (signals
phoneScore 0.55 @640 with the 4:3 cover crop). Attribution + share-alike apply to the fixture file.
Alternative without share-alike: `Woman holds a cushion while using her smartphone at home.jpg`
(<https://commons.wikimedia.org/wiki/File:Woman_holds_a_cushion_while_using_her_smartphone_at_home.jpg>,
Shixart1985, CC BY 2.0; phone 0.80; face not frontal) — PHONE_SUSPECTED +21.0 s / +20.3 s.

## Reproduce

```bash
cd frontend/bench/vision
# test sets (see README.md): build-manifest.mjs, fetch-images.mjs, fetch-commons.mjs
# candidate models into .cache/models/ (URLs + sha256 in public/models/README.md)
export PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core   # or `npm ci` in tests/e2e
node build.mjs                      # bundles harness/*.ts into $TMPDIR (outside the repo)
node run.mjs                        # COCO set, ~23 min here → .cache/results/raw.json
node run.mjs --set commons          # Commons set + Face Landmarker → raw-commons.json
node run-mem.mjs                    # memory / per-model latency → mem.json
node analyze.mjs                    # tables.md + summary.json (real state machine + classifyFrame)
node run-e2e.mjs --scenes "/commons/commons_15.jpg@0,/commons/commons_08.jpg@20000" --duration 60000 --camera 640x480 [--cpu-throttle 4]
```
