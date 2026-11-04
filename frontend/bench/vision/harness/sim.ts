/**
 * Node-side behaviour simulation with the REAL state machine (src/features/monitoring/engine).
 * Bundled by ../analyze.mjs for Node. Feeds synthetic observation sequences built from measured
 * per-frame scores and reports the time from "phone appears" to DISTRACTION_SUSPECTED.
 */
import { DEFAULT_ENGINE_CONFIG, type EngineConfig, type FrameObservation } from '@/features/monitoring/contracts';
import { createStateMachine } from '@/features/monitoring/engine/stateMachine';

export interface SeqOptions {
  /** Pool of measured phone scores for this image (one is drawn per phone evaluation). */
  phoneScores: number[];
  /** Face+pose cadence and phone cadence actually used (ms). */
  intervalMs: number;
  phoneIntervalMs: number;
  /** Simulated duration after the phone appears (ms). */
  durationMs: number;
  seed: number;
  config?: Partial<EngineConfig>;
  /** Optional k-of-n pre-filter on per-evaluation decisions (applied before the state machine). */
  kOfN?: { k: number; n: number };
  /**
   * Probability that a phone evaluation repeats the previous draw instead of drawing a new one.
   * 0 = independent draws (optimistic); 0.8 ≈ real frames, where a hidden / badly lit phone stays so for a while.
   */
  stickiness?: number;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const base = (at: number): FrameObservation => ({
  at,
  frameQuality: 'OK',
  faceDetected: true,
  faceScore: 0.9,
  upperBodyDetected: true,
  poseScore: 0.95,
  personDetected: true,
  personScore: 0.9,
  phoneEvaluated: false,
  phoneDetected: false,
  phoneScore: 0,
  inferenceMs: 10,
});

/**
 * Student is seated (FOCUS_ESTIMATED after the normal 15 s), then at t=0 the phone appears and stays.
 * Returns ms from t=0 to DISTRACTION_SUSPECTED, or null if it did not happen within durationMs.
 * With `phoneScores` from phone-free images the same function measures false suspicion.
 */
export function phoneLatency(o: SeqOptions): number | null {
  const cfg = { ...DEFAULT_ENGINE_CONFIG, ...o.config };
  const rand = rng(o.seed);
  const t0 = 1_000_000;
  const sm = createStateMachine(cfg, { state: 'UNKNOWN', since: t0 - 30_000 });
  // Seat the student first (no phone).
  for (let t = t0 - 30_000; t < t0; t += o.intervalMs) sm.observe(base(t));
  if (sm.state !== 'FOCUS_ESTIMATED') throw new Error(`setup failed: ${sm.state}`);
  let lastPhone = Number.NEGATIVE_INFINITY;
  const recent: boolean[] = [];
  let prev: number | null = null;
  for (let t = t0; t <= t0 + o.durationMs; t += o.intervalMs) {
    const obs = base(t);
    if (t - lastPhone >= o.phoneIntervalMs) {
      lastPhone = t;
      const stick = prev !== null && rand() < (o.stickiness ?? 0);
      let s: number = stick && prev !== null ? prev : (o.phoneScores[Math.floor(rand() * o.phoneScores.length)] ?? 0);
      prev = s;
      if (o.kOfN) {
        recent.push(s >= cfg.phoneMinScore);
        if (recent.length > o.kOfN.n) recent.shift();
        s = recent.filter(Boolean).length >= o.kOfN.k ? 1 : 0;
      }
      obs.phoneEvaluated = true;
      obs.phoneScore = s;
      obs.phoneDetected = s >= cfg.phoneMinScore;
    }
    const tr = sm.observe(obs);
    if (tr?.state === 'DISTRACTION_SUSPECTED') return t - t0;
  }
  return null;
}

/** Measured per-image scores of one (still) scene, as the production reducers report them. */
export interface SceneScores {
  face: number;
  shoulders: number;
  person: number;
  phone?: number;
  /** min(eyeBlinkLeft, eyeBlinkRight) when Face Landmarker found a face; undefined otherwise. */
  eyesClosed?: number;
}

function sceneObs(at: number, s: SceneScores, detector: boolean, cfg: EngineConfig): FrameObservation {
  const o: FrameObservation = {
    at,
    frameQuality: 'OK',
    faceDetected: s.face > 0,
    faceScore: s.face,
    upperBodyDetected: s.shoulders >= cfg.poseMinVisibility,
    poseScore: s.shoulders,
    phoneEvaluated: detector,
    phoneDetected: detector && (s.phone ?? 0) >= cfg.phoneMinScore,
    phoneScore: detector ? (s.phone ?? 0) : 0,
    inferenceMs: 10,
  };
  if (detector) {
    o.personScore = s.person;
    o.personDetected = s.person >= 0.5;
  }
  if (s.eyesClosed !== undefined) o.eyesClosedScore = s.eyesClosed;
  return o;
}

/**
 * Monitoring starts (UNKNOWN) on a still scene. Returns ms from the first frame to the first transition
 * into `target` (default FOCUS_ESTIMATED), or null within durationMs. The object detector runs on the
 * first frame and then every phoneIntervalMs, like the controller.
 */
export function timeToState(o: { scene: SceneScores; intervalMs: number; phoneIntervalMs: number; durationMs: number; config?: Partial<EngineConfig>; from?: 'UNKNOWN' | 'FOCUS_ESTIMATED'; target?: string }): number | null {
  const cfg = { ...DEFAULT_ENGINE_CONFIG, ...o.config };
  const t0 = 1_000_000;
  const sm = createStateMachine(cfg, { state: o.from ?? 'UNKNOWN', since: t0 - 1 });
  let lastDet = Number.NEGATIVE_INFINITY;
  for (let t = t0; t <= t0 + o.durationMs; t += o.intervalMs) {
    const det = t - lastDet >= o.phoneIntervalMs;
    if (det) lastDet = t;
    const tr = sm.observe(sceneObs(t, o.scene, det, cfg));
    if (tr && tr.state === (o.target ?? 'FOCUS_ESTIMATED')) return t - t0;
  }
  return null;
}

/** compare.mjs: whether this engine version understands `eyesClosedScore` (v1.3+). */
export const supportsEyes = () => 'eyesClosedMinScore' in DEFAULT_ENGINE_CONFIG;

export { classifyFrame } from '@/features/monitoring/engine/stateMachine';
export { toFrameObservation } from '@/lib/vision/observation';
export { visionSettingsFromConfig } from '@/lib/vision/config';
export { DEFAULT_ENGINE_CONFIG } from '@/features/monitoring/contracts';
