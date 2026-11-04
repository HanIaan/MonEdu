/**
 * BINDING CONTRACT (owner: C0). Interfaces between:
 *   W1  lib/vision + features/monitoring/engine   (implements VisionPipeline, StateMachine, MonitoringController)
 *   C0  features/monitoring/session               (implements StudySessionApi via useStudySession)
 *   W3  features/monitoring/ui, app/, dashboard   (consumes StudySessionApi / MonitoringSnapshot)
 * Semantics: docs/contracts/state-machine.md. Do not edit — file a CONTRACT_CHANGE_REQUEST.
 * v1.2 (Phase 2): optional FrameObservation.person*, MonitoringPerf adaptive-cadence fields. All optional:
 * producers (W1) SHOULD populate them, consumers (W3) MUST handle `undefined`.
 * v1.3: seatedConfirmMs 15 s → 3 s, phoneMinScore 0.5 → 0.4, phone rule = repeated detection (not continuous),
 * eyes-closed drowsiness (FrameObservation.eyesClosedScore?, EngineConfig.drowsyMs/eyesClosedMinScore,
 * reason DROWSINESS_SUSPECTED). See docs/contracts/state-machine.md.
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
  | 'DROWSINESS_SUSPECTED'
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
  /** Phone seen repeatedly (while present) for this long → DISTRACTION_SUSPECTED (PHONE_SUSPECTED). */
  phoneSuspectMs: number;
  /** v1.3: eyes-closed run (while present) needed for FOCUS → DISTRACTION_SUSPECTED (DROWSINESS_SUSPECTED). */
  drowsyMs: number;
  /** Present with no phone and eyes not closed for this long: DISTRACTION_SUSPECTED → FOCUS_ESTIMATED. */
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
  /** v1.3: `eyesClosedScore` at or above this counts as "eyes closed". */
  eyesClosedMinScore: number;
  /** Face + pose inference cadence. */
  inferenceIntervalMs: number;
  /** Object (phone) detector cadence. */
  phoneIntervalMs: number;
  /** Requested camera resolution (`ideal` constraints). v1.2: 640×480 — +7 pp phone recall at ~+1 ms/tick (bench §A). */
  camera: { width: number; height: number; frameRate: number };
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  seatedConfirmMs: 3_000,
  awayMs: 30_000,
  phoneSuspectMs: 20_000,
  drowsyMs: 15_000,
  focusResumeMs: 15_000,
  uncertainMs: 10_000,
  debounceMs: 3_000,
  staleFrameMs: 5_000,
  presenceMinScore: 0.6,
  absentMaxScore: 0.3,
  poseMinVisibility: 0.5,
  phoneMinScore: 0.4,
  eyesClosedMinScore: 0.6,
  inferenceIntervalMs: 500,
  phoneIntervalMs: 1_000,
  camera: { width: 640, height: 480, frameRate: 15 },
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
  /**
   * v1.2 (optional): COCO "person" evidence from the object detector, used to reject non-human faces
   * (pets). Only meaningful when `phoneEvaluated` (the detector ran this tick).
   */
  personDetected?: boolean;
  /** v1.2 (optional): best COCO "person" score, 0..1. */
  personScore?: number;
  /**
   * v1.3 (optional): min(eyeBlinkLeft, eyeBlinkRight) from Face Landmarker blendshapes, 0..1 (1 = both
   * eyes closed). Undefined when the landmarker did not run this tick or found no face.
   */
  eyesClosedScore?: number;
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
  /** v1.2 (optional): p95 of the last ≤100 inference times (ms). */
  p95InferenceMs?: number;
  /** v1.2 (optional): face+pose cadence currently in effect (ms) after load adaptation. */
  effectiveIntervalMs?: number;
  /** v1.2 (optional): object-detector cadence currently in effect (ms). */
  effectivePhoneIntervalMs?: number;
  /** v1.2 (optional): true while the adaptive scheduler has slowed cadence because inference is slow. */
  lowPower?: boolean;
  /** v1.2 (optional): frames not analysed because no new frame arrived (stale) or a newer frame superseded them. */
  framesDropped?: number;
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
  /** v1.2 (optional): reason of the engine's most recent transition (null before the first one). */
  lastReason?: ClientTransitionReason | null;
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

/**
 * What the student study screen (W3) consumes via `useStudySession()`.
 * v1.1: the session layer owns the ANALYSIS <video> (attached to document.body, independent of any
 * React component). UI previews only render `cameraStream`; mounting/unmounting a preview never
 * affects inference.
 */
export interface StudySessionApi {
  status: SessionStatus;
  session: StudySession | null;
  monitoring: MonitoringSnapshot;
  sync: SyncStatus;
  /** Live camera stream for an OPTIONAL preview (null when the camera is off). Read-only use. */
  cameraStream: MediaStream | null;
  /** Start server session, then camera + engine. Must be called from a user gesture. */
  start(): Promise<void>;
  /** Student-controlled stop of monitoring (camera released). Session stays ACTIVE. */
  pauseMonitoring(): void;
  /** Must be called from a user gesture. */
  resumeMonitoring(): Promise<void>;
  startBreak(): void;
  endBreak(): void;
  /** End the study session. */
  end(): Promise<void>;
}
