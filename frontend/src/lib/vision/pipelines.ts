/**
 * VisionPipeline implementations (contract: features/monitoring/contracts.ts).
 *  - WorkerVisionPipeline: module Web Worker, frames sent as transferred ImageBitmaps.
 *  - MainThreadVisionPipeline: same runner on the main thread (fallback).
 *  - AutoVisionPipeline: tries the worker first, falls back to the main thread if it cannot load.
 */
import type { EngineConfig, FrameObservation, InferenceBackend, VisionPipeline } from '@/features/monitoring/contracts';
import { visionSettingsFromConfig, type VisionSettings } from './config';
import type { MediaPipeRunner } from './mediapipeRunner';
import type { FromWorker, ToWorker } from './protocol';

type Source = HTMLVideoElement | ImageBitmap;
type AnalyzeOpts = { runPhone: boolean };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isImageBitmap = (s: unknown): s is ImageBitmap => typeof ImageBitmap !== 'undefined' && s instanceof ImageBitmap;

/** Minimal Worker surface (lets tests inject a fake). */
export interface WorkerLike {
  postMessage(message: ToWorker, transfer?: Transferable[]): void;
  addEventListener(type: 'message', l: (ev: MessageEvent<FromWorker>) => void): void;
  addEventListener(type: 'error' | 'messageerror', l: (ev: Event) => void): void;
  removeEventListener(type: string, l: (ev: never) => void): void;
  terminate(): void;
}

/**
 * CLASSIC worker on purpose: Next 16 Turbopack compiles `new Worker(new URL(...))` into a bootstrap
 * (`static/chunks/turbopack-worker-*.js`) that loads the worker's chunks with `importScripts`, which
 * throws in a `{ type: 'module' }` worker — the worker then dies and we fall back to the main thread.
 * Keep the `new Worker(new URL('…', import.meta.url))` shape literal so the bundler recognises it.
 */
export const defaultWorkerFactory = (): WorkerLike =>
  new Worker(new URL('./vision.worker.ts', import.meta.url), { name: 'vision' }) as unknown as WorkerLike;

export interface WorkerPipelineOptions {
  createWorker?: () => WorkerLike;
  createBitmap?: (video: HTMLVideoElement) => Promise<ImageBitmap>;
  /** Max time for the worker script to start and post `ready` (fast fallback). Default 4 s. */
  startTimeoutMs?: number;
  /** Max time for WASM + models to load once the worker is running. Default 30 s. */
  loadTimeoutMs?: number;
}

export class WorkerVisionPipeline implements VisionPipeline {
  readonly backend: InferenceBackend = 'WORKER';
  private worker: WorkerLike | null = null;
  private disposed = false;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (o: FrameObservation) => void; reject: (e: Error) => void }>();
  private loadWaiter: { resolve: () => void; reject: (e: Error) => void; started: () => void } | null = null;
  private loadPromise: Promise<void> | null = null;
  private readonly createWorker: () => WorkerLike;
  private readonly createBitmap: (video: HTMLVideoElement) => Promise<ImageBitmap>;
  private readonly loadTimeoutMs: number;
  private readonly startTimeoutMs: number;
  /** Diagnostics: whether the worker reported running as an ES module worker. */
  moduleWorker: boolean | null = null;

  constructor(
    private readonly settings: VisionSettings,
    opts: WorkerPipelineOptions = {},
  ) {
    this.createWorker = opts.createWorker ?? defaultWorkerFactory;
    this.createBitmap = opts.createBitmap ?? ((v) => createImageBitmap(v));
    this.loadTimeoutMs = opts.loadTimeoutMs ?? 30_000;
    this.startTimeoutMs = opts.startTimeoutMs ?? 4_000;
  }

  private readonly onMessage = (ev: MessageEvent<FromWorker>) => {
    const msg = ev.data;
    switch (msg.type) {
      case 'ready':
        this.moduleWorker = msg.moduleWorker;
        this.loadWaiter?.started();
        break;
      case 'loaded':
        this.loadWaiter?.resolve();
        this.loadWaiter = null;
        break;
      case 'loadError':
        this.loadWaiter?.reject(new Error(`worker model load failed: ${msg.message}`));
        this.loadWaiter = null;
        break;
      case 'result':
      case 'analyzeError': {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.type === 'result') p.resolve(msg.observation);
        else p.reject(new Error(msg.message));
        break;
      }
    }
  };

  private readonly onError = (ev: Event) => {
    const message = (ev as ErrorEvent).message || 'vision worker error';
    this.failAll(new Error(message));
  };

  private failAll(err: Error) {
    this.loadWaiter?.reject(err);
    this.loadWaiter = null;
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  load(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('pipeline disposed'));
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const clear = () => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
      };
      const done = (err?: Error) => {
        clear();
        if (err) reject(err);
        else resolve();
      };
      this.loadWaiter = {
        resolve: () => done(),
        reject: (e) => done(e),
        // Worker script is running: switch from the short start timeout to the model-load timeout.
        started: () => {
          clear();
          timer = setTimeout(() => this.failAll(new Error('vision worker model load timed out')), this.loadTimeoutMs);
        },
      };
      try {
        const w = this.createWorker();
        this.worker = w;
        w.addEventListener('message', this.onMessage);
        w.addEventListener('error', this.onError);
        w.addEventListener('messageerror', this.onError);
        timer = setTimeout(() => this.failAll(new Error('vision worker did not start')), this.startTimeoutMs);
        w.postMessage({ type: 'load', settings: this.settings });
      } catch (e) {
        this.loadWaiter = null;
        done(new Error(`vision worker could not start: ${errMsg(e)}`));
      }
    });
    this.loadPromise.catch(() => {
      this.loadPromise = null;
    });
    return this.loadPromise;
  }

  async analyze(source: Source, at: number, opts: AnalyzeOpts): Promise<FrameObservation> {
    if (this.disposed || !this.worker) {
      if (isImageBitmap(source)) source.close();
      throw new Error('vision worker not loaded');
    }
    const bitmap = isImageBitmap(source) ? source : await this.createBitmap(source);
    const worker = this.worker;
    if (this.disposed || !worker) {
      bitmap.close();
      throw new Error('pipeline disposed');
    }
    const id = this.nextId++;
    return new Promise<FrameObservation>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        // Transfer: the bitmap is neutered here and closed by the worker.
        worker.postMessage({ type: 'analyze', id, bitmap, at, runPhone: opts.runPhone }, [bitmap]);
      } catch (e) {
        this.pending.delete(id);
        bitmap.close();
        reject(new Error(errMsg(e)));
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.failAll(new Error('pipeline disposed'));
    const w = this.worker;
    this.worker = null;
    if (w) {
      try {
        w.postMessage({ type: 'dispose' });
      } catch {
        /* worker already gone */
      }
      w.removeEventListener('message', this.onMessage);
      w.removeEventListener('error', this.onError);
      w.removeEventListener('messageerror', this.onError);
      w.terminate();
    }
  }
}

export class MainThreadVisionPipeline implements VisionPipeline {
  readonly backend: InferenceBackend = 'MAIN_THREAD';
  private runner: MediaPipeRunner | null = null;
  private loadPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(private readonly settings: VisionSettings) {}

  load(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('pipeline disposed'));
    this.loadPromise ??= (async () => {
      // Lazy imports: tasks-vision must not be evaluated during SSR.
      const [tasks, { MediaPipeRunner }] = await Promise.all([import('@mediapipe/tasks-vision'), import('./mediapipeRunner')]);
      const runner = await MediaPipeRunner.create(tasks, this.settings, false);
      if (this.disposed) {
        runner.close();
        throw new Error('pipeline disposed');
      }
      this.runner = runner;
    })();
    this.loadPromise.catch(() => {
      this.loadPromise = null;
    });
    return this.loadPromise;
  }

  async analyze(source: Source, at: number, opts: AnalyzeOpts): Promise<FrameObservation> {
    try {
      if (!this.runner) throw new Error('vision models not loaded');
      return this.runner.analyze(source, at, opts.runPhone);
    } finally {
      if (isImageBitmap(source)) source.close();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.runner?.close();
    this.runner = null;
  }
}

export interface AutoPipelineOptions extends WorkerPipelineOptions {
  /** Skip the worker attempt (e.g. for debugging). */
  forceMainThread?: boolean;
  /** Injected for tests. */
  createMain?: (s: VisionSettings) => VisionPipeline;
}

/** Worker first, main-thread fallback. `backend` reflects the implementation actually in use. */
export class AutoVisionPipeline implements VisionPipeline {
  private impl: VisionPipeline | null = null;
  private disposed = false;
  /** Why the worker path was abandoned (diagnostics only). */
  workerError: string | null = null;

  constructor(
    private readonly settings: VisionSettings,
    private readonly opts: AutoPipelineOptions = {},
  ) {}

  get backend(): InferenceBackend {
    return this.impl?.backend ?? (this.opts.forceMainThread ? 'MAIN_THREAD' : 'WORKER');
  }

  async load(): Promise<void> {
    if (this.disposed) throw new Error('pipeline disposed');
    if (this.impl) return this.impl.load();
    const workerUsable = !this.opts.forceMainThread && (this.opts.createWorker || typeof Worker !== 'undefined');
    if (workerUsable) {
      const w = new WorkerVisionPipeline(this.settings, this.opts);
      try {
        await w.load();
        if (this.disposed) {
          w.dispose();
          throw new Error('pipeline disposed');
        }
        this.impl = w;
        return;
      } catch (e) {
        w.dispose();
        if (this.disposed) throw e;
        this.workerError = errMsg(e);
        console.warn('[vision] worker unavailable, falling back to main thread:', this.workerError);
      }
    }
    const m = (this.opts.createMain ?? ((s) => new MainThreadVisionPipeline(s)))(this.settings);
    try {
      await m.load();
    } catch (e) {
      m.dispose();
      throw e;
    }
    if (this.disposed) {
      m.dispose();
      throw new Error('pipeline disposed');
    }
    this.impl = m;
  }

  analyze(source: Source, at: number, opts: AnalyzeOpts): Promise<FrameObservation> {
    if (!this.impl) return Promise.reject(new Error('vision models not loaded'));
    return this.impl.analyze(source, at, opts);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.impl?.dispose();
    this.impl = null;
  }
}

export function createVisionPipeline(
  config?: Pick<EngineConfig, 'poseMinVisibility' | 'phoneMinScore'>,
  opts?: AutoPipelineOptions,
): VisionPipeline {
  return new AutoVisionPipeline(visionSettingsFromConfig(config), opts);
}
