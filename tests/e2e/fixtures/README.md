# E2E camera fixtures

Chrome's fake capture device plays `--use-file-for-fake-video-capture=<file>.mjpeg` (concatenated
JPEG frames). `global-setup.ts` builds `*.mjpeg` from these stills at test time (gitignored).

| file | source | license |
|---|---|---|
| `person.jpg` | `https://storage.googleapis.com/mediapipe-assets/pose.jpg` (MediaPipe test asset), cropped to the upper body (600×450 at x=200,y=180) and resized to 640×480 with macOS `sips`. Face is in profile — exercises the *upper body visible, face not required* path. | Apache-2.0 (MediaPipe) |
| `nobody.jpg` | `https://storage.googleapis.com/mediapipe-assets/cats_and_dogs.jpg` (MediaPipe test asset), resized + center-cropped to 640×480 | Apache-2.0 (MediaPipe) |

A static still is a *best case* for detection (no motion blur, good light); it does not measure
real-world accuracy.
