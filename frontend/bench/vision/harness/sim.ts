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
  for (let t = t0; t <= t0 + o.durationMs; t += o.intervalMs) {
    const obs = base(t);
    if (t - lastPhone >= o.phoneIntervalMs) {
      lastPhone = t;
      let s = o.phoneScores[Math.floor(rand() * o.phoneScores.length)] ?? 0;
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

export { classifyFrame } from '@/features/monitoring/engine/stateMachine';
export { toFrameObservation } from '@/lib/vision/observation';
export { visionSettingsFromConfig } from '@/lib/vision/config';
export { DEFAULT_ENGINE_CONFIG } from '@/features/monitoring/contracts';
