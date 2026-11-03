/**
 * BINDING CONTRACT (owner: C0). Interfaces between:
 *   W1  lib/vision + features/monitoring/engine   (implements VisionPipeline, StateMachine, MonitoringController)
 *   C0  features/monitoring/session               (implements StudySessionApi via useStudySession)
 *   W3  features/monitoring/ui, app/, dashboard   (consumes StudySessionApi / MonitoringSnapshot)
 * Semantics: docs/contracts/state-machine.md. Do not edit — file a CONTRACT_CHANGE_REQUEST.
 */
import type { components } from '@/lib/api/schema';

export type ActivityState = components['schemas']['ActivityState'];
export type TransitionReason = components['schemas']['TransitionReason'];
export type TransitionSignals = components['schemas']['TransitionSignals'];
export type StudySession = components['schemas']['StudySession'];

export const ACTIVITY_STATES = [
  'FOCUS_ESTIMATED',
  'DISTRACTION_SUSPECTED',
  'AWAY',
  'UNKNOWN',
  'BREAK',
] as const satisfies readonly ActivityState[];

/** Reasons the client engine may emit (server-only reasons excluded). */
export type ClientTransitionReason = Extract<
  TransitionReason,
  | 'SEATED_CONFIRMED'
  | 'FOCUS_RESUMED'
  | 'PRESENCE_LOST'
  | 'PHONE_SUSPECTED'
  | 'LOW_CONFIDENCE'
  | 'CAMERA_STOPPED'
  | 'CAMERA_PERMISSION_DENIED'
  | 'INFERENCE_STALLED'
  | 'MODEL_ERROR'
  | 'MONITORING_PAUSED'
  | 'BREAK_STARTED'
  | 'BREAK_ENDED'
  | 'RECONNECTED'
>;

// ───────────────────────────── Configuration ─────────────────────────────

export interface EngineConfig {
  /** PRESENT run needed to confirm seating (UNKNOWN/AWAY → FOCUS_ESTIMATED). */
  seatedConfirmMs: number;
  /** ABSENT run needed for → AWAY. */
  awayMs: number;
  /** Phone run (while present) needed for FOCUS → DISTRACTION_SUSPECTED. */
  phoneSuspectMs: number;
  /** No-phone present run needed for DISTRACTION_SUSPECTED → FOCUS_ESTIMATED. */
  focusResumeMs: number;
  /** UNCERTAIN run needed for → UNKNOWN (LOW_CONFIDENCE). */
  uncertainMs: number;
  /** Contrary evidence must persist this long to break a run (hysteresis). */
  debounceMs: number;
  /** No processed frame for this long → UNKNOWN (INFERENCE_STALLED). */
  staleFrameMs: number;
  presenceMinScore: number;
  absentMaxScore: number;
  poseMinVisibility: number;
  phoneMinScore: number;
  /** Face + pose inference cadence. */
  inferenceIntervalMs: number;
  /** Object (phone) detector cadence. */
  phoneIntervalMs: number;
  /** Requested camera resolution (low-res first). */
  camera: { width: number; height: number; frameRate: number };
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  seatedConfirmMs: 15_000,
  awayMs: 30_000,
  phoneSuspectMs: 20_000,
  focusResumeMs: 15_000,
  uncertainMs: 10_000,
  debounceMs: 3_000,
  staleFrameMs: 5_000,
  presenceMinScore: 0.6,
  absentMaxScore: 0.3,
  poseMinVisibility: 0.5,
  phoneMinScore: 0.5,
  inferenceIntervalMs: 500,
  phoneIntervalMs: 1_000,
  camera: { width: 320, height: 240, frameRate: 15 },
};

// ───────────────────────────── Vision (W1: lib/vision) ─────────────────────────────

/** Coarse per-tick result. Never contains pixels, landmarks, boxes or embeddings. */
export interface FrameObservation {
  /** Epoch ms (performance.timeOrigin + performance.now()) when the frame was captured. */
  at: number;
  /** 'LOW' when the frame is too dark/uniform/blurred to judge. */
  frameQuality: 'OK' | 'LOW';
  faceDetected: boolean;
  /** Best face detection score, 0..1 (0 if none). */
  faceScore: number;
  /** Both shoulders visible with visibility >= poseMinVisibility. */
  upperBodyDetected: boolean;
  /** Min visibility of the two shoulder landmarks, 0..1 (0 if no pose). */
  poseScore: number;
  /** Whether the object detector ran on this tick (it runs at phoneIntervalMs). */
  phoneEvaluated: boolean;
  phoneDetected: boolean;
  /** Best COCO "cell phone" score, 0..1 (0 if none or not evaluated). */
  phoneScore: number;
  /** Set when a model failed on this tick; the engine treats the tick as UNCERTAIN. */
  error?: string;
  /** Wall time spent in inference for this tick (ms), for perf telemetry. */
  inferenceMs: number;
}

export type InferenceBackend = 'WORKER' | 'MAIN_THREAD';

export interface VisionPipeline {
  readonly backend: InferenceBackend;
  /** Load WASM + models from same-origin /mediapipe/wasm and /models. Rejects on failure. */
  load(): Promise<void>;
  /** Analyze one frame. `runPhone` controls whether the object detector runs this tick. */
  analyze(source: HTMLVideoElement | ImageBitmap, at: number, opts: { runPhone: boolean }): Promise<FrameObservation>;
  /** Release models/worker. Safe to call twice. */
  dispose(): void;
}

// ───────────────────────────── Engine (W1: features/monitoring/engine) ─────────────────────────────

export interface EngineTransition {
  from: ActivityState;
  state: ActivityState;
  reason: ClientTransitionReason;
  /** Epoch ms of evidence onset (state-machine.md §3). */
  detectedAt: number;
  /** 0..1 confidence of the evidence run. */
  confidence: number;
  signals: TransitionSignals;
}

/** Pure, deterministic, clock-injected state machine (unit-testable without a camera). */
export interface StateMachine {
  readonly state: ActivityState;
  readonly stateSince: number;
  /** Feed one observation. Returns a transition if the state changed. */
  observe(obs: FrameObservation): EngineTransition | null;
  /** Periodic check without a new frame (stall detection). `now` = epoch ms. */
  tick(now: number, pageVisible: boolean): EngineTransition | null;
  cameraLost(reason: 'CAMERA_STOPPED' | 'CAMERA_PERMISSION_DENIED' | 'MODEL_ERROR', now: number): EngineTransition | null;
  pause(now: number): EngineTransition | null;
  startBreak(now: number): EngineTransition | null;
  endBreak(now: number): EngineTransition | null;
  /** Clear evidence runs (e.g. after camera restart) without changing state. */
  resetEvidence(): void;
}

export type CreateStateMachine = (config?: Partial<EngineConfig>, initial?: { state: ActivityState; since: number }) => StateMachine;

export type CameraStatus =
  | 'idle'
  | 'requesting'
  | 'active'
  | 'denied' // NotAllowedError / permission revoked
  | 'unavailable' // no device / NotFoundError / NotReadableError
  | 'stopped' // track ended or stopped by user
  | 'error';

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface MonitoringPerf {
  framesProcessed: number;
  /** Ticks skipped because the previous inference was still running. */
  framesSkipped: number;
  avgInferenceMs: number;
  /** performance.memory.usedJSHeapSize where available (Chrome), else null. */
  jsHeapBytes: number | null;
}

export interface MonitoringSnapshot {
  cameraStatus: CameraStatus;
  modelStatus: ModelStatus;
  engineState: ActivityState;
  /** Epoch ms. */
  stateSince: number;
  lastFrameAt: number | null;
  lastObservation: FrameObservation | null;
  pageVisible: boolean;
  inferenceBackend: InferenceBackend | null;
  onBreak: boolean;
  paused: boolean;
  perf: MonitoringPerf;
  error: string | null;
}

/** Owns camera + vision + scheduler + state machine. Implemented by W1. */
export interface MonitoringController {
  /** Request camera (explicit user action only), load models, begin inference. */
  start(video: HTMLVideoElement): Promise<void>;
  /** Pause monitoring: release camera + stop inference, emit UNKNOWN (MONITORING_PAUSED). */
  pause(): void;
  startBreak(): void;
  endBreak(): void;
  getSnapshot(): MonitoringSnapshot;
  /** useSyncExternalStore-compatible. Notifies at most ~4×/s. */
  subscribe(listener: () => void): () => void;
  onTransition(listener: (t: EngineTransition) => void): () => void;
  /** Stop everything and release camera, models, timers, listeners. Idempotent. */
  dispose(): void;
}

export type CreateMonitoringController = (config?: Partial<EngineConfig>) => MonitoringController;

// ───────────────────────────── Session sync (C0: features/monitoring/session) ─────────────────────────────

export type SessionStatus = 'idle' | 'starting' | 'active' | 'ending' | 'ended' | 'error';

export interface SyncStatus {
  online: boolean;
  pendingEvents: number;
  lastHeartbeatAt: number | null;
  lastError: string | null;
}

/** What the student study screen (W3) consumes via `useStudySession()`. */
export interface StudySessionApi {
  status: SessionStatus;
  session: StudySession | null;
  monitoring: MonitoringSnapshot;
  sync: SyncStatus;
  /** Start server session, then camera + engine. Must be called from a user gesture. */
  start(video: HTMLVideoElement): Promise<void>;
  /** Student-controlled stop of monitoring (camera released). Session stays ACTIVE. */
  pauseMonitoring(): void;
  resumeMonitoring(video: HTMLVideoElement): Promise<void>;
  startBreak(): void;
  endBreak(): void;
  /** End the study session. */
  end(): Promise<void>;
}
