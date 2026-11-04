/**
 * Runs the MediaPipe Tasks Vision models (face, pose, object; v1.3 + optional Face Landmarker) on one frame. Used both inside the module worker
 * and on the main thread (fallback). The `tasks` module is injected so the main thread can import
 * `@mediapipe/tasks-vision` lazily (it must never be evaluated during SSR).
 *
 * Notes on @mediapipe/tasks-vision 1.2.0 (verified by reading vision_bundle.mjs):
 * - The WASM loader is fetched with `importScripts` when it is a function, else via a <script> tag.
 *   In a *module* worker `importScripts` exists but throws TypeError; the bundle then calls
 *   `self.import(url)` if defined, else `import(url)`. The classic loader (`vision_wasm_internal.js`)
 *   declares `var ModuleFactory` which stays module-scoped under `import()`, so in a module worker
 *   we MUST use `FilesetResolver.forVisionTasks(base, true)` (→ `vision_wasm_module_internal.js`,
 *   which assigns `globalThis.ModuleFactory`).
 * - With no canvas option the graph runner creates an `OffscreenCanvas(1,1)` when available
 *   (Safari < 17 excluded); without one it needs `document`, so worker init fails there and the
 *   pipeline falls back to the main thread.
 */
import type { FrameObservation } from '@/features/monitoring/contracts';
import type * as TasksVision from '@mediapipe/tasks-vision';
import { MODEL_FILES, PERSON_CATEGORY, PHONE_CATEGORY, type VisionSettings } from './config';
import { FrameQualitySampler } from './frameQuality';
import { bestFaceScore, toFrameObservation, type RawVisionResults } from './observation';

type TasksModule = Pick<typeof TasksVision, 'FilesetResolver' | 'FaceDetector' | 'PoseLandmarker' | 'ObjectDetector'> &
  Partial<Pick<typeof TasksVision, 'FaceLandmarker'>>;
type Source = TexImageSource & CanvasImageSource;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const perfNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class MediaPipeRunner {
  private face: TasksVision.FaceDetector | null = null;
  private pose: TasksVision.PoseLandmarker | null = null;
  private object: TasksVision.ObjectDetector | null = null;
  /** v1.3, optional: drowsiness is simply not measured when it is missing or failed to load. */
  private faceLm: TasksVision.FaceLandmarker | null = null;
  private readonly sampler = new FrameQualitySampler();
  private lastTs = 0;
  private baseAt: number | null = null;
  private closed = false;

  private constructor(private readonly settings: VisionSettings) {}

  static async create(tasks: TasksModule, settings: VisionSettings, useModuleLoader: boolean): Promise<MediaPipeRunner> {
    const runner = new MediaPipeRunner(settings);
    try {
      const fileset = await tasks.FilesetResolver.forVisionTasks(settings.wasmBaseUrl, useModuleLoader);
      const model = (f: string) => `${settings.modelBaseUrl}/${f}`;
      // Sequential on purpose: three concurrent WASM instantiations spike memory on low-end devices.
      runner.face = await tasks.FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: model(MODEL_FILES.face), delegate: 'CPU' },
        runningMode: 'VIDEO',
        minDetectionConfidence: settings.faceMinDetectionConfidence,
      });
      runner.pose = await tasks.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: model(MODEL_FILES.pose), delegate: 'CPU' },
        runningMode: 'VIDEO',
        numPoses: 1,
        outputSegmentationMasks: false,
      });
      runner.object = await tasks.ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: model(MODEL_FILES.object), delegate: 'CPU' },
        runningMode: 'VIDEO',
        // person (v1.2 presence corroboration) + phone; maxResults covers several people AND a phone.
        categoryAllowlist: [PHONE_CATEGORY, PERSON_CATEGORY],
        scoreThreshold: settings.objectScoreThreshold,
        maxResults: 10,
      });
      if (tasks.FaceLandmarker) {
        try {
          runner.faceLm = await tasks.FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: model(MODEL_FILES.faceLandmarker), delegate: 'CPU' },
            runningMode: 'VIDEO',
            numFaces: 1,
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: false,
          });
        } catch (e) {
          console.warn('[vision] face landmarker unavailable, drowsiness not measured:', errMsg(e));
        }
      }
    } catch (e) {
      runner.close();
      throw e;
    }
    return runner;
  }

  /**
   * VIDEO-mode tasks require strictly increasing timestamps. They must also be small: tasks-vision
   * saturates the ms timestamp at int32 max (observed: every epoch-ms frame became 2147483647000 µs →
   * "Packet timestamp mismatch" and the pose/object graphs stay broken). So use ms since the first frame.
   */
  private nextTs(at: number): number {
    if (this.baseAt === null) this.baseAt = at;
    this.lastTs = Math.max(this.lastTs + 1, Math.round(at - this.baseAt) + 1);
    return this.lastTs;
  }

  analyze(source: Source, at: number, runPhone: boolean): FrameObservation {
    if (this.closed) throw new Error('vision runner closed');
    const t0 = perfNow();
    const errors: string[] = [];
    const q = this.sampler.measure(source);
    const raw: RawVisionResults = {
      at,
      frameQuality: q?.quality ?? 'OK',
      faceDetections: null,
      poseLandmarks: null,
      objectDetections: null,
      phoneEvaluated: false,
      errors,
      inferenceMs: 0,
    };
    // Dark / uniform frame: the engine treats it as UNCERTAIN anyway, so skip the models (saves CPU).
    if (raw.frameQuality === 'OK') {
      const ts = this.nextTs(at);
      try {
        raw.faceDetections = this.face?.detectForVideo(source, ts).detections ?? null;
      } catch (e) {
        errors.push(`face: ${errMsg(e)}`);
      }
      if (this.faceLm && bestFaceScore(raw.faceDetections) >= this.settings.eyesMinFaceScore) {
        try {
          raw.faceBlendshapes = this.faceLm.detectForVideo(source, ts).faceBlendshapes[0]?.categories ?? null;
        } catch (e) {
          errors.push(`eyes: ${errMsg(e)}`);
        }
      }
      try {
        const res = this.pose?.detectForVideo(source, ts);
        raw.poseLandmarks = res ? (res.landmarks[0] ?? []) : null;
        res?.close();
      } catch (e) {
        errors.push(`pose: ${errMsg(e)}`);
      }
      if (runPhone) {
        try {
          raw.objectDetections = this.object?.detectForVideo(source, ts).detections ?? null;
          raw.phoneEvaluated = raw.objectDetections !== null;
        } catch (e) {
          errors.push(`object: ${errMsg(e)}`);
        }
      }
    }
    raw.inferenceMs = perfNow() - t0;
    return toFrameObservation(raw, this.settings);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const t of [this.face, this.pose, this.object, this.faceLm]) {
      try {
        t?.close();
      } catch {
        /* already closed */
      }
    }
    this.face = this.pose = this.object = this.faceLm = null;
    this.sampler.dispose();
  }
}
