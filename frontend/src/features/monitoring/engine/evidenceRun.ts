/**
 * Hysteresis run tracker (state-machine.md §3).
 *
 * A *run* is a contiguous period of the same evidence value, measured in elapsed time from its
 * onset. A run is broken only when contrary evidence has persisted for `debounceMs` without a single
 * supporting sample in between; the new run is then back-dated to the first sample of the new value
 * inside that contrary window. Single contrary samples (or bursts shorter than `debounceMs`) never
 * reset the run. Durations depend only on sample timestamps, never on how many samples arrived.
 */
export class EvidenceRun<V extends string | boolean> {
  private value: V | null = null;
  private onsetAt = 0;
  private lastAt = 0;
  /** First time each contrary value was seen since the last supporting sample. */
  private contrary = new Map<V, number>();
  private contraryStart: number | null = null;
  /** Running mean of per-sample confidence for the current run. */
  private confSum = 0;
  private confN = 0;

  constructor(private readonly debounceMs: number) {}

  get current(): V | null {
    return this.value;
  }
  get onset(): number {
    return this.onsetAt;
  }
  get lastSampleAt(): number {
    return this.lastAt;
  }
  get confidence(): number {
    return this.confN > 0 ? this.confSum / this.confN : 0;
  }
  /** Elapsed run duration at `now` (0 when there is no run). */
  duration(now: number): number {
    return this.value === null ? 0 : Math.max(0, now - this.onsetAt);
  }
  is(v: V): boolean {
    return this.value === v;
  }

  update(v: V, at: number, confidence = 1): void {
    this.lastAt = at;
    if (this.value === null) {
      this.start(v, at, confidence);
      return;
    }
    if (v === this.value) {
      this.contrary.clear();
      this.contraryStart = null;
      this.confSum += confidence;
      this.confN++;
      return;
    }
    if (this.contraryStart === null) this.contraryStart = at;
    if (!this.contrary.has(v)) this.contrary.set(v, at);
    if (at - this.contraryStart >= this.debounceMs) {
      this.start(v, this.contrary.get(v) ?? at, confidence);
    }
  }

  private start(v: V, onset: number, confidence: number) {
    this.value = v;
    this.onsetAt = onset;
    this.contrary.clear();
    this.contraryStart = null;
    this.confSum = confidence;
    this.confN = 1;
  }

  reset(): void {
    this.value = null;
    this.onsetAt = 0;
    this.lastAt = 0;
    this.contrary.clear();
    this.contraryStart = null;
    this.confSum = 0;
    this.confN = 0;
  }
}
