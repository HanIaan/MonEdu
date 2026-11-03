import { describe, expect, it } from 'vitest';
import { AdaptiveCadence, MAX_INTERVAL_MS, MAX_PHONE_INTERVAL_MS, p95 } from './adaptiveCadence';

const feed = (c: AdaptiveCadence, ms: number, n: number, start: number, step: number) => {
  let t = start;
  for (let i = 0; i < n; i++) {
    t += step;
    c.record(ms, t);
  }
  return t;
};

describe('AdaptiveCadence', () => {
  it('p95 of an empty / small window', () => {
    expect(p95([])).toBe(0);
    expect(p95([5])).toBe(5);
    expect(p95(Array.from({ length: 100 }, (_, i) => i + 1))).toBe(95);
  });

  it('keeps the configured cadence while inference is cheap', () => {
    const c = new AdaptiveCadence(500, 1000, 0);
    feed(c, 60, 200, 0, 500);
    expect(c.level).toBe(0);
    expect(c.intervalMs).toBe(500);
    expect(c.phoneIntervalMs).toBe(1000);
    expect(c.lowPower).toBe(false);
    expect(c.p95InferenceMs).toBe(60);
  });

  it('slows down when p95 > 40 % of the interval, only after enough samples', () => {
    const c = new AdaptiveCadence(500, 1000, 0);
    feed(c, 300, 19, 0, 500);
    expect(c.level).toBe(0); // 19 samples: not yet judged
    feed(c, 300, 1, 9500, 500);
    expect(c.level).toBe(1);
    expect(c.intervalMs).toBe(750);
    expect(c.phoneIntervalMs).toBe(1500);
    expect(c.lowPower).toBe(true);
    // 300 ms at 750 ms = exactly 40 % → stays
    feed(c, 300, 50, 10_000, 750);
    expect(c.level).toBe(1);
  });

  it('a slow first frame (warm-up) and rare outliers (2 %) do not slow the cadence', () => {
    const c = new AdaptiveCadence(500, 1000, 0);
    let t = 0;
    // 900 ms warm-up frame, then one 900 ms outlier every 50 frames (2 %)
    for (let i = 0; i < 300; i++) c.record(i % 50 === 0 ? 900 : 50, (t += 500));
    expect(c.level).toBe(0);
  });

  it('a very slow device jumps straight to the level that fits, capped at 2 s / 4 s', () => {
    const c = new AdaptiveCadence(500, 1000, 0);
    feed(c, 1_500, 20, 0, 2_000);
    expect(c.level).toBe(4);
    expect(c.intervalMs).toBe(MAX_INTERVAL_MS);
    expect(c.phoneIntervalMs).toBe(MAX_PHONE_INTERVAL_MS);
    const d = new AdaptiveCadence(500, 1000, 0);
    feed(d, 400, 20, 0, 500); // needs ≥ 1000 ms → level 2 (×2), not 1
    expect(d.intervalMs).toBe(1_000);
    expect(d.phoneIntervalMs).toBe(2_000);
  });

  it('recovers one level at a time with hysteresis: ≥ 20 cheap samples and ≥ 10 s at the level', () => {
    const c = new AdaptiveCadence(500, 1000, 0);
    let t = feed(c, 400, 20, 0, 500); // → level 2 (1000 ms)
    expect(c.level).toBe(2);
    // load falls to 100 ms: 100 < 0.25·750 → may step down, but only after 20 samples & 10 s
    t = feed(c, 100, 19, t, 1000);
    expect(c.level).toBe(2);
    t = feed(c, 100, 1, t, 1000);
    expect(c.level).toBe(1);
    // 100 < 0.25·500 = 125 → back to level 0 after another 20 samples / 10 s
    t = feed(c, 100, 19, t, 750);
    expect(c.level).toBe(1);
    t = feed(c, 100, 1, t, 750);
    expect(c.level).toBe(0);
    expect(c.lowPower).toBe(false);
    // medium load (150 ms): 30 % of 500 → stays at 0 (no oscillation between 0.25 and 0.4)
    feed(c, 150, 100, t, 500);
    expect(c.level).toBe(0);
  });

  it('does not oscillate at a load between the two thresholds', () => {
    const c = new AdaptiveCadence(500, 1000, 0);
    let t = feed(c, 250, 20, 0, 500); // 50 % → level 1
    expect(c.level).toBe(1);
    let changes = 0;
    for (let i = 0; i < 500; i++) if (c.record(250, (t += 750))) changes++;
    expect(changes).toBe(0); // 250 is 33 % of 750 (< 40 %) and 50 % of 500 (not < 25 %)
    expect(c.level).toBe(1);
  });

  it('ignores invalid samples; reset() returns to full cadence', () => {
    const c = new AdaptiveCadence(500, 1000, 0);
    c.record(Number.NaN, 1);
    c.record(-5, 2);
    expect(c.p95InferenceMs).toBe(0);
    feed(c, 1_000, 30, 0, 500);
    expect(c.lowPower).toBe(true);
    c.reset(100_000);
    expect(c.level).toBe(0);
    expect(c.p95InferenceMs).toBe(0);
  });

  it('never goes faster than the configured base cadence', () => {
    const c = new AdaptiveCadence(3_000, 5_000, 0);
    expect(c.intervalMs).toBe(3_000); // base above the cap stays as configured
    feed(c, 2_000, 30, 0, 3_000);
    expect(c.intervalMs).toBe(3_000);
    expect(c.phoneIntervalMs).toBe(5_000);
  });
});
