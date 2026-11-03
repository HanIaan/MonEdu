import { describe, expect, it } from 'vitest';
import { VideoFrameTracker } from './frameFreshness';

const asVideo = (v: object) => v as unknown as HTMLVideoElement;

describe('VideoFrameTracker', () => {
  it('currentTime: new only when it changes', () => {
    const v = { currentTime: 1 };
    const t = new VideoFrameTracker(asVideo(v));
    expect(t.consumeNewFrame()).toBe(true);
    expect(t.consumeNewFrame()).toBe(false);
    v.currentTime = 1.033;
    expect(t.consumeNewFrame()).toBe(true);
    expect(t.consumeNewFrame()).toBe(false);
  });

  it('no observable signal (no numeric currentTime, no rVFC) → every tick counts as new (previous behaviour)', () => {
    const t = new VideoFrameTracker(asVideo({ currentTime: Number.NaN }));
    expect(t.consumeNewFrame()).toBe(true);
    expect(t.consumeNewFrame()).toBe(true);
  });
});
