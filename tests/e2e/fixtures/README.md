# E2E camera fixtures

Stills drawn into a canvas `captureStream()` that replaces `getUserMedia` (see `specs/helpers.ts`
`installCanvasCamera`), so tests can switch scenes at runtime. Inference still runs the real MediaPipe
models. (Chrome Headless Shell rejects `--use-file-for-fake-video-capture` with NotFoundError, so
file-based fake devices are not used.)

| file | source | license |
|---|---|---|
| `person.jpg` | `https://storage.googleapis.com/mediapipe-assets/pose.jpg` (MediaPipe test asset), cropped to the upper body (600×450 at x=200,y=180) and resized to 640×480 with macOS `sips`. Face is in profile — exercises the *upper body visible, face not required* path. | Apache-2.0 (MediaPipe) |
| `nobody.jpg` | same `pose.jpg`, person-free right strip (220×667 at x=780) stretched to 640×480 — sky/sea/sand only. Measured: face none, pose none, objects none. | Apache-2.0 (MediaPipe) |
| `phone.jpg` (Phase 2) | "Woman holds a cushion while using her smartphone at home" by Shixart1985, <https://commons.wikimedia.org/wiki/File:Woman_holds_a_cushion_while_using_her_smartphone_at_home.jpg> (960 px thumbnail), centre-cropped to 4:3 and resized to 640×480 with `sips`. Phone clearly visible, face mostly out of frame. Picked from W1's bench (`frontend/bench/vision/RESULTS.md`, hand-off): phone 0.80, real controller PHONE_SUSPECTED ≈ +21 s. | CC BY 2.0 <https://creativecommons.org/licenses/by/2.0> — modified (cropped/resized) |
| `pets.jpg` (Phase 2) | `https://storage.googleapis.com/mediapipe-assets/cats_and_dogs.jpg` (sha256 a2eaa7ad…56df9c), centre-cropped 800×600 and resized to 640×480. Two cats and two dogs, no person. Regression fixture for the v1 defect "pet faces read as present". | Apache-2.0 (MediaPipe) |

A static still is a *best case* for detection (no motion blur, good light); it does not measure
real-world accuracy.

**`pets.jpg` history:** in v1 BlazeFace detected the animals' faces at 0.71–0.79 (≥ presenceMinScore
0.6), so a pet-only frame read as *present*. Since v1.2 presence also requires a COCO `person`
detection (state-machine.md §2) and the E2E `pets only → never FOCUS` locks that in.
