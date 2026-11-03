/**
 * Adaptive inference cadence for slow devices (owner: W1; telemetry = contract v1.2 MonitoringPerf).
 *
 * The controller reports every inference time; this class keeps the last ≤ 100 and picks a cadence
 * level. Level 0 = the configured `inferenceIntervalMs` / `phoneIntervalMs`; higher levels multiply
 * both by a fixed factor. Rules (evaluated on samples taken since the last level change, so a level is
 * judged by what it actually costs):
 *   - slow down when p95 > SLOW_RATIO × current interval (inference would hog the CPU), after
 *     ≥ MIN_SAMPLES samples at this level — straight to the first level where p95 fits;
 *   - speed up ONE level when p95 of the last RECOVER_SAMPLES samples < FAST_RATIO × the next faster
 *     interval (recent samples only, so a load that just went away is noticed; hysteresis: after speeding
 *     up the ratio is still well under SLOW_RATIO), after ≥ RECOVER_SAMPLES samples and ≥ RECOVER_MS
 *     at this level.
 * Cadence only changes how OFTEN we sample. The state machine measures every duration from frame
 * timestamps (elapsed time), so a slower cadence does not change accounting; it adds detection latency
 * of up to one interval and fewer samples per run (see bench/vision/RESULTS.md §D).
 *
 * The slowest level keeps the face/pose interval ≤ 2 s so that a slow-but-working device stays far
 * from `staleFrameMs` (5 s → INFERENCE_STALLED), and the phone interval ≤ 4 s.
 */

/** Interval multipliers per level (level 0 = configured cadence). */
export const CADENCE_LEVELS = [1, 1.5, 2, 3, 4] as const;
export const SLOW_RATIO = 0.4;
export const FAST_RATIO = 0.25;
export const MIN_SAMPLES = 20;
export const RECOVER_SAMPLES = 20;
export const RECOVER_MS = 10_000;
export const WINDOW = 100;
/** Hard caps, independent of the configured base cadence. */
export const MAX_INTERVAL_MS = 2_000;
export const MAX_PHONE_INTERVAL_MS = 4_000;

export function p95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)] ?? 0;
}

export class AdaptiveCadence {
  private readonly samples: number[] = [];
  private levelSamples: number[] = [];
  private _level = 0;
  private levelSince: number;

  constructor(
    private readonly baseIntervalMs: number,
    private readonly basePhoneIntervalMs: number,
    now: number,
  ) {
    this.levelSince = now;
  }

  get level(): number {
    return this._level;
  }
  get lowPower(): boolean {
    return this._level > 0;
  }
  private factor(level: number): number {
    return CADENCE_LEVELS[Math.min(level, CADENCE_LEVELS.length - 1)] ?? 1;
  }
  private intervalAt(level: number): number {
    return Math.max(this.baseIntervalMs, Math.min(MAX_INTERVAL_MS, Math.round(this.baseIntervalMs * this.factor(level))));
  }
  get intervalMs(): number {
    return this.intervalAt(this._level);
  }
  get phoneIntervalMs(): number {
    return Math.max(this.basePhoneIntervalMs, Math.min(MAX_PHONE_INTERVAL_MS, Math.round(this.basePhoneIntervalMs * this.factor(this._level))));
  }
  /** p95 of the last ≤ 100 inference times (ms); 0 before the first sample. */
  get p95InferenceMs(): number {
    return p95(this.samples);
  }

  /** Record a sample for telemetry only (adaptation disabled). */
  recordOnly(inferenceMs: number): void {
    if (!Number.isFinite(inferenceMs) || inferenceMs < 0) return;
    this.samples.push(inferenceMs);
    if (this.samples.length > WINDOW) this.samples.shift();
  }

  /** Record one inference time. Returns true when the cadence level changed. */
  record(inferenceMs: number, now: number): boolean {
    if (!Number.isFinite(inferenceMs) || inferenceMs < 0) return false;
    this.samples.push(inferenceMs);
    if (this.samples.length > WINDOW) this.samples.shift();
    this.levelSamples.push(inferenceMs);
    if (this.levelSamples.length > WINDOW) this.levelSamples.shift();

    const n = this.levelSamples.length;
    const q = p95(this.levelSamples);
    const maxLevel = CADENCE_LEVELS.length - 1;
    if (n >= MIN_SAMPLES && q > SLOW_RATIO * this.intervalMs && this._level < maxLevel && this.intervalAt(this._level + 1) > this.intervalMs) {
      // Jump straight to the first level where p95 fits (a very slow device should not need minutes to adapt).
      let next = this._level + 1;
      while (next < maxLevel && q > SLOW_RATIO * this.intervalAt(next)) next++;
      return this.setLevel(next, now);
    }
    if (
      this._level > 0 &&
      n >= RECOVER_SAMPLES &&
      now - this.levelSince >= RECOVER_MS &&
      p95(this.levelSamples.slice(-RECOVER_SAMPLES)) < FAST_RATIO * this.intervalAt(this._level - 1)
    ) {
      return this.setLevel(this._level - 1, now);
    }
    return false;
  }

  private setLevel(level: number, now: number): boolean {
    this._level = level;
    this.levelSince = now;
    this.levelSamples = [];
    return true;
  }

  /** Forget history (e.g. camera restart); keeps nothing between runs. */
  reset(now: number): void {
    this.samples.length = 0;
    this.levelSamples = [];
    this._level = 0;
    this.levelSince = now;
  }
}
