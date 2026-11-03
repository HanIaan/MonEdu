/**
 * MonitoringController (contract: features/monitoring/contracts.ts). Owns camera + vision pipeline +
 * scheduler + state machine. All browser APIs are injectable for tests.
 *
 * Scheduling: a setTimeout chain at `inferenceIntervalMs`. Every tick first runs the state machine's
 * stall check, then starts an inference unless the previous one is still running (→ framesSkipped).
 * The object detector runs when ≥ `phoneIntervalMs` of elapsed time passed since it last ran.
 * Background tabs may throttle or freeze timers; we do not rely on them running — the state machine
 * detects the gap (tick / visibilitychange / next frame) and reports INFERENCE_STALLED.
 */
import { createVisionPipeline } from '@/lib/vision';
import { nowMs } from '@/lib/time';
import type {
  CameraStatus,
  CreateMonitoringController,
  EngineConfig,
  EngineTransition,
  FrameObservation,
  MonitoringController,
  MonitoringPerf,
  MonitoringSnapshot,
  StateMachine,
  VisionPipeline,
} from '../contracts';
import { createStateMachine, mergeConfig } from './stateMachine';

type TimerId = ReturnType<typeof setTimeout>;

interface PermissionStatusLike {
  state: string;
  addEventListener(type: 'change', l: () => void): void;
  removeEventListener(type: 'change', l: () => void): void;
}

export interface ControllerDeps {
  createPipeline?: (config: EngineConfig) => VisionPipeline;
  mediaDevices?: Pick<MediaDevices, 'getUserMedia'>;
  permissions?: { query(d: { name: string }): Promise<PermissionStatusLike> };
  document?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => TimerId;
  clearTimeout?: (id: TimerId) => void;
  /** Notification throttle for subscribe() listeners (default 250 ms ≈ 4/s). */
  notifyIntervalMs?: number;
  /** Consecutive analyze() rejections before the model is declared broken (MODEL_ERROR). */
  maxConsecutiveFailures?: number;
  memory?: () => number | null;
  createStateMachine?: typeof createStateMachine;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const errName = (e: unknown) => (e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : '');

function defaultMemory(): number | null {
  const m = (typeof performance !== 'undefined' ? (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory : undefined)
    ?.usedJSHeapSize;
  return typeof m === 'number' ? m : null;
}

class MonitoringControllerImpl implements MonitoringController {
  private readonly cfg: EngineConfig;
  private readonly sm: StateMachine;
  private readonly now: () => number;
  private readonly setT: (fn: () => void, ms: number) => TimerId;
  private readonly clearT: (id: TimerId) => void;
  private readonly deps: ControllerDeps;

  private snapshot: MonitoringSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly transitionListeners = new Set<(t: EngineTransition) => void>();

  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private pipeline: VisionPipeline | null = null;
  private loopTimer: TimerId | null = null;
  private notifyTimer: TimerId | null = null;
  private lastNotifyAt = Number.NEGATIVE_INFINITY;
  private permissionStatus: PermissionStatusLike | null = null;
  private trackCleanup: (() => void) | null = null;
  private visibilityBound = false;
  /** Bumped whenever the current run is torn down; stale async work checks it and bails out. */
  private generation = 0;
  private busy = false;
  private lastPhoneAt = Number.NEGATIVE_INFINITY;
  private consecutiveFailures = 0;
  private perf: MonitoringPerf = { framesProcessed: 0, framesSkipped: 0, avgInferenceMs: 0, jsHeapBytes: null };
  private disposed = false;

  constructor(config: Partial<EngineConfig> | undefined, deps: ControllerDeps) {
    this.cfg = mergeConfig(config);
    this.deps = deps;
    this.now = deps.now ?? nowMs;
    this.setT = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearT = deps.clearTimeout ?? ((id) => clearTimeout(id));
    const startedAt = this.now();
    this.sm = (deps.createStateMachine ?? createStateMachine)(this.cfg, { state: 'UNKNOWN', since: startedAt });
    this.snapshot = {
      cameraStatus: 'idle',
      modelStatus: 'idle',
      engineState: this.sm.state,
      stateSince: this.sm.stateSince,
      lastFrameAt: null,
      lastObservation: null,
      pageVisible: this.readVisible(),
      inferenceBackend: null,
      onBreak: false,
      paused: false,
      perf: { ...this.perf },
      error: null,
    };
  }

  // ───────────────────────── public API ─────────────────────────

  async start(video: HTMLVideoElement): Promise<void> {
    if (this.disposed) throw new Error('MonitoringController disposed');
    if (this.stream) return; // already running
    const gen = ++this.generation;
    this.video = video;
    this.update({ cameraStatus: 'requesting', paused: false, error: null });

    const md = this.deps.mediaDevices ?? (typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined);
    if (!md?.getUserMedia) {
      this.update({ cameraStatus: 'unavailable', error: 'camera API unavailable (needs HTTPS or localhost)' });
      this.emit(this.sm.cameraLost('CAMERA_STOPPED', this.now()));
      throw new Error('getUserMedia unavailable');
    }

    let stream: MediaStream;
    try {
      const { width, height, frameRate } = this.cfg.camera;
      stream = await md.getUserMedia({
        audio: false,
        video: { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: frameRate, max: frameRate }, facingMode: 'user' },
      });
    } catch (e) {
      if (gen !== this.generation) throw e;
      const denied = errName(e) === 'NotAllowedError' || errName(e) === 'SecurityError';
      this.update({ cameraStatus: denied ? 'denied' : 'unavailable', error: errMsg(e) });
      this.emit(this.sm.cameraLost(denied ? 'CAMERA_PERMISSION_DENIED' : 'CAMERA_STOPPED', this.now()));
      throw e;
    }
    if (gen !== this.generation || this.disposed) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('monitoring stopped during start');
    }
    this.stream = stream;
    this.bindTrack(stream, gen);
    void this.bindPermission(gen);
    this.bindVisibility();

    try {
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
    } catch {
      // Autoplay rejection or test env; frames are checked via readyState before every inference.
    }
    if (gen !== this.generation) throw new Error('monitoring stopped during start');
    this.update({ cameraStatus: 'active' });

    this.update({ modelStatus: 'loading' });
    const pipeline = (this.deps.createPipeline ?? ((c) => createVisionPipeline(c)))(this.cfg);
    this.pipeline = pipeline;
    try {
      await pipeline.load();
    } catch (e) {
      if (gen !== this.generation) throw e;
      this.update({ modelStatus: 'error', error: `model load failed: ${errMsg(e)}` });
      this.emit(this.sm.cameraLost('MODEL_ERROR', this.now()));
      this.releaseResources();
      this.update({ cameraStatus: 'stopped' });
      throw e;
    }
    if (gen !== this.generation) throw new Error('monitoring stopped during start');
    this.update({ modelStatus: 'ready', inferenceBackend: pipeline.backend });

    this.sm.resetEvidence(); // fresh runs: re-confirm seating after every (re)start
    this.consecutiveFailures = 0;
    this.lastPhoneAt = Number.NEGATIVE_INFINITY;
    this.scheduleLoop(gen, 0);
  }

  pause(): void {
    if (this.disposed) return;
    this.releaseResources();
    this.emit(this.sm.pause(this.now()));
    this.update({ paused: true, cameraStatus: 'stopped', modelStatus: 'idle', inferenceBackend: null });
  }

  startBreak(): void {
    if (this.disposed) return;
    this.emit(this.sm.startBreak(this.now()));
    this.update({ onBreak: true });
  }

  endBreak(): void {
    if (this.disposed) return;
    this.emit(this.sm.endBreak(this.now()));
    this.update({ onBreak: false });
  }

  getSnapshot = (): MonitoringSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  onTransition(listener: (t: EngineTransition) => void): () => void {
    this.transitionListeners.add(listener);
    return () => {
      this.transitionListeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.releaseResources();
    this.disposed = true;
    if (this.notifyTimer !== null) this.clearT(this.notifyTimer);
    this.notifyTimer = null;
    this.listeners.clear();
    this.transitionListeners.clear();
    this.video = null;
  }

  // ───────────────────────── scheduler ─────────────────────────

  private scheduleLoop(gen: number, delay: number) {
    this.loopTimer = this.setT(() => this.loopTick(gen), delay);
  }

  private loopTick(gen: number) {
    this.loopTimer = null;
    if (gen !== this.generation || this.disposed) return;
    const now = this.now();
    this.emit(this.sm.tick(now, this.readVisible()));
    if (this.snapshot.onBreak) {
      // Break: engine ignores frames, so do not spend CPU on inference.
    } else if (this.busy) {
      this.perf.framesSkipped++;
      this.update({});
    } else {
      void this.runInference(gen, now);
    }
    this.scheduleLoop(gen, this.cfg.inferenceIntervalMs);
  }

  private async runInference(gen: number, at: number) {
    const video = this.video;
    const pipeline = this.pipeline;
    if (!video || !pipeline) return;
    if (typeof video.readyState === 'number' && video.readyState < 2) return; // HAVE_CURRENT_DATA
    const runPhone = at - this.lastPhoneAt >= this.cfg.phoneIntervalMs;
    if (runPhone) this.lastPhoneAt = at;
    this.busy = true;
    let obs: FrameObservation;
    try {
      obs = await pipeline.analyze(video, at, { runPhone });
    } catch (e) {
      if (gen !== this.generation) return;
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= (this.deps.maxConsecutiveFailures ?? 3)) {
        this.update({ modelStatus: 'error', error: `inference failed: ${errMsg(e)}` });
        this.releaseResources();
        this.emit(this.sm.cameraLost('MODEL_ERROR', this.now()));
        this.update({ cameraStatus: 'stopped' });
        return;
      }
      obs = {
        at,
        frameQuality: 'OK',
        faceDetected: false,
        faceScore: 0,
        upperBodyDetected: false,
        poseScore: 0,
        phoneEvaluated: false,
        phoneDetected: false,
        phoneScore: 0,
        error: errMsg(e),
        inferenceMs: 0,
      };
    } finally {
      if (gen === this.generation) this.busy = false;
    }
    if (gen !== this.generation || this.disposed) return;
    if (!obs.error) this.consecutiveFailures = 0;
    const n = ++this.perf.framesProcessed;
    this.perf.avgInferenceMs = n === 1 ? obs.inferenceMs : this.perf.avgInferenceMs + (obs.inferenceMs - this.perf.avgInferenceMs) / Math.min(n, 50);
    this.perf.jsHeapBytes = (this.deps.memory ?? defaultMemory)();
    this.emit(this.sm.observe(obs));
    this.update({ lastFrameAt: obs.at, lastObservation: obs });
  }

  // ───────────────────────── camera / page events ─────────────────────────

  private bindTrack(stream: MediaStream, gen: number) {
    const tracks = stream.getVideoTracks();
    const onEnded = () => {
      if (gen !== this.generation) return;
      this.cameraLost('CAMERA_STOPPED', 'stopped');
    };
    tracks.forEach((t) => t.addEventListener('ended', onEnded));
    this.trackCleanup = () => tracks.forEach((t) => t.removeEventListener('ended', onEnded));
  }

  private readonly onPermissionChange = () => {
    if (this.permissionStatus?.state === 'denied' && this.stream) this.cameraLost('CAMERA_PERMISSION_DENIED', 'denied');
  };

  private async bindPermission(gen: number) {
    const perms = this.deps.permissions ?? (typeof navigator !== 'undefined' ? (navigator.permissions as ControllerDeps['permissions']) : undefined);
    if (!perms?.query) return;
    try {
      const status = await perms.query({ name: 'camera' });
      if (gen !== this.generation || this.disposed) return;
      this.permissionStatus = status;
      status.addEventListener('change', this.onPermissionChange);
    } catch {
      // 'camera' permission name unsupported (e.g. older Firefox/Safari): rely on track `ended`.
    }
  }

  private readonly onVisibility = () => {
    const visible = this.readVisible();
    this.emit(this.sm.tick(this.now(), visible));
    this.update({ pageVisible: visible });
  };

  private bindVisibility() {
    const doc = this.deps.document ?? (typeof document !== 'undefined' ? document : undefined);
    if (!doc || this.visibilityBound) return;
    doc.addEventListener('visibilitychange', this.onVisibility);
    this.visibilityBound = true;
  }

  private readVisible(): boolean {
    const doc = this.deps.document ?? (typeof document !== 'undefined' ? document : undefined);
    return doc ? doc.visibilityState !== 'hidden' : true;
  }

  private cameraLost(reason: 'CAMERA_STOPPED' | 'CAMERA_PERMISSION_DENIED', status: CameraStatus) {
    this.releaseResources();
    this.emit(this.sm.cameraLost(reason, this.now()));
    this.update({ cameraStatus: status, modelStatus: 'idle', inferenceBackend: null });
  }

  /** Stop tracks, timers, worker/models and listeners for the current run. Idempotent. */
  private releaseResources() {
    this.generation++;
    this.busy = false;
    if (this.loopTimer !== null) this.clearT(this.loopTimer);
    this.loopTimer = null;
    this.trackCleanup?.();
    this.trackCleanup = null;
    this.stream?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    });
    this.stream = null;
    if (this.video) {
      try {
        this.video.pause?.();
      } catch {
        /* jsdom */
      }
      this.video.srcObject = null;
    }
    this.pipeline?.dispose();
    this.pipeline = null;
    this.permissionStatus?.removeEventListener('change', this.onPermissionChange);
    this.permissionStatus = null;
    if (this.visibilityBound) {
      const doc = this.deps.document ?? (typeof document !== 'undefined' ? document : undefined);
      doc?.removeEventListener('visibilitychange', this.onVisibility);
      this.visibilityBound = false;
    }
  }

  // ───────────────────────── state / notify ─────────────────────────

  private emit(t: EngineTransition | null) {
    if (!t) return;
    for (const l of [...this.transitionListeners]) {
      try {
        l(t);
      } catch (e) {
        console.error('[monitoring] transition listener failed', e);
      }
    }
    this.update({});
  }

  private update(patch: Partial<MonitoringSnapshot>) {
    if (this.disposed) return;
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      engineState: this.sm.state,
      stateSince: this.sm.stateSince,
      perf: { ...this.perf },
    };
    this.scheduleNotify();
  }

  private scheduleNotify() {
    if (this.notifyTimer !== null || this.listeners.size === 0) return;
    const interval = this.deps.notifyIntervalMs ?? 250;
    const wait = Math.max(0, this.lastNotifyAt + interval - this.now());
    this.notifyTimer = this.setT(() => {
      this.notifyTimer = null;
      this.lastNotifyAt = this.now();
      for (const l of [...this.listeners]) {
        try {
          l();
        } catch (e) {
          console.error('[monitoring] subscriber failed', e);
        }
      }
    }, wait);
  }
}

export const createMonitoringController = ((config?: Partial<EngineConfig>, deps: ControllerDeps = {}) =>
  new MonitoringControllerImpl(config, deps)) satisfies CreateMonitoringController;
