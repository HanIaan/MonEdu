# E2E camera fixtures

Stills drawn into a canvas `captureStream()` that replaces `getUserMedia` (see `specs/helpers.ts`
`installCanvasCamera`), so tests can switch scenes at runtime. Inference still runs the real MediaPipe
models. (Chrome Headless Shell rejects `--use-file-for-fake-video-capture` with NotFoundError, so
file-based fake devices are not used.)

| file | source | license |
|---|---|---|
| `person.jpg` | `https://storage.googleapis.com/mediapipe-assets/pose.jpg` (MediaPipe test asset), cropped to the upper body (600×450 at x=200,y=180) and resized to 640×480 with macOS `sips`. Face is in profile — exercises the *upper body visible, face not required* path. | Apache-2.0 (MediaPipe) |
| `nobody.jpg` | same `pose.jpg`, person-free right strip (220×667 at x=780) stretched to 640×480 — sky/sea/sand only. Measured: face none, pose none, objects none. | Apache-2.0 (MediaPipe) |

A static still is a *best case* for detection (no motion blur, good light); it does not measure
real-world accuracy.

**Why not `cats_and_dogs.jpg`:** BlazeFace detected the animals' faces at 0.71–0.79 (≥ presenceMinScore
0.6), so a pet-only frame reads as *present*. Recorded as a known limitation in `docs/limitations.md`.
