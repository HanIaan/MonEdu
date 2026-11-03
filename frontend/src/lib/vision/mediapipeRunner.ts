/**
 * Runs the three MediaPipe Tasks Vision models on one frame. Used both inside the module worker
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
import { MODEL_FILES, PHONE_CATEGORY, type VisionSettings } from './config';
import { FrameQualitySampler } from './frameQuality';
import { toFrameObservation, type RawVisionResults } from './observation';

type TasksModule = Pick<typeof TasksVision, 'FilesetResolver' | 'FaceDetector' | 'PoseLandmarker' | 'ObjectDetector'>;
type Source = TexImageSource & CanvasImageSource;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const perfNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class MediaPipeRunner {
  private face: TasksVision.FaceDetector | null = null;
  private pose: TasksVision.PoseLandmarker | null = null;
  private object: TasksVision.ObjectDetector | null = null;
  private readonly sampler = new FrameQualitySampler();
  private lastTs = 0;
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
        categoryAllowlist: [PHONE_CATEGORY],
        scoreThreshold: settings.objectScoreThreshold,
        maxResults: 3,
      });
    } catch (e) {
      runner.close();
      throw e;
    }
    return runner;
  }

  /** VIDEO-mode tasks require strictly increasing timestamps. */
  private nextTs(at: number): number {
    this.lastTs = Math.max(this.lastTs + 1, Math.round(at));
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
    for (const t of [this.face, this.pose, this.object]) {
      try {
        t?.close();
      } catch {
        /* already closed */
      }
    }
    this.face = this.pose = this.object = null;
    this.sampler.dispose();
  }
}
