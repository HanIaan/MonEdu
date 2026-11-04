/**
 * Repeated-detection tracker for an intermittent per-frame detector (v1.3 phone rule,
 * state-machine.md §3). Unlike `EvidenceRun`, a run here does not need *consecutive* positives: the
 * object detector misses a visible phone in many frames (bench/vision/RESULTS.md §E), so a phone that is
 * detected in every second frame must still count as "the phone is there".
 *
 * An *episode* starts at the first positive sample and ends when no positive sample arrived for the gap
 * (≥ `minGapMs`, and ≥ 2.5 detector intervals so a slower adaptive cadence does not end it after a
 * single miss). Durations depend only on sample timestamps.
 */
interface Sample {
  at: number;
  positive: boolean;
  score: number;
}

export class RepeatedEvidence {
  private samples: Sample[] = [];
  private startAt: number | null = null;
  private lastPositiveAt: number | null = null;
  /** First sample after the last positive one (null while the last sample is positive). */
  private clearAt: number | null = null;
  private lastAt: number | null = null;
  private spacing = 0;

  /** `keepMs` = longest window that will be asked for (older samples are dropped). */
  constructor(
    private readonly minGapMs: number,
    private readonly keepMs: number,
  ) {}

  private gap(): number {
    return Math.max(this.minGapMs, 2.5 * this.spacing);
  }

  update(positive: boolean, at: number, score: number): void {
    if (this.lastAt !== null && at > this.lastAt) this.spacing = at - this.lastAt;
    this.lastAt = at;
    this.expire(at);
    if (positive) {
      this.startAt ??= at;
      this.lastPositiveAt = at;
      this.clearAt = null;
    } else if (this.clearAt === null && this.lastPositiveAt !== null) {
      this.clearAt = at;
    }
    if (this.startAt !== null) this.samples.push({ at, positive, score });
    while (this.samples.length > 0 && this.samples[0]!.at < at - this.keepMs) this.samples.shift();
  }

  /** End the episode once no positive sample arrived for the gap. */
  private expire(now: number): void {
    if (this.startAt !== null && this.lastPositiveAt !== null && now - this.lastPositiveAt > this.gap()) {
      this.startAt = null;
      this.samples = [];
    }
  }

  /** True while an episode is open at `now`. */
  active(now: number): boolean {
    this.expire(now);
    return this.startAt !== null;
  }

  /** First positive sample of the open episode. */
  get onset(): number | null {
    return this.startAt;
  }

  /** Last positive sample (null if none since the last reset). */
  get lastPositive(): number | null {
    return this.lastPositiveAt;
  }

  /**
   * When the evidence went away: the first sample after the last positive one (or the last positive
   * itself if no later sample arrived). null if no positive sample was ever seen.
   */
  get clearSince(): number | null {
    if (this.lastPositiveAt === null) return null;
    return this.clearAt ?? this.lastPositiveAt;
  }

  /** Share of positive samples and their mean score inside [now − windowMs, now] of the open episode. */
  window(now: number, windowMs: number): { ratio: number; positives: number; meanScore: number } {
    const from = now - windowMs;
    let n = 0;
    let pos = 0;
    let sum = 0;
    for (const s of this.samples) {
      if (s.at < from || s.at > now) continue;
      n++;
      if (s.positive) {
        pos++;
        sum += s.score;
      }
    }
    return { ratio: n > 0 ? pos / n : 0, positives: pos, meanScore: pos > 0 ? sum / pos : 0 };
  }

  reset(): void {
    this.samples = [];
    this.startAt = null;
    this.lastPositiveAt = null;
    this.clearAt = null;
    this.lastAt = null;
    this.spacing = 0;
  }
}
