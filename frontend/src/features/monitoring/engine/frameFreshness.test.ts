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

  function rvfcVideo(currentTime = 0) {
    let cb: (() => void) | null = null;
    const v = {
      currentTime,
      requestVideoFrameCallback: (f: () => void) => {
        cb = f;
        return 1;
      },
      cancelVideoFrameCallback: () => {},
      present: () => cb!(),
    };
    return v;
  }

  it('after rVFC has fired it is authoritative: currentTime advancing without rVFC → stale (frozen MediaStream)', () => {
    const v = rvfcVideo(10);
    const t = new VideoFrameTracker(asVideo(v));
    v.present();
    expect(t.consumeNewFrame()).toBe(true);
    // camera source stops producing frames: currentTime (wall clock) keeps advancing, rVFC silent
    for (let i = 1; i <= 6; i++) {
      v.currentTime = 10 + i * 0.5;
      expect(t.consumeNewFrame()).toBe(false);
    }
    v.present();
    expect(t.consumeNewFrame()).toBe(true);
    expect(t.consumeNewFrame()).toBe(false);
  });

  it('rVFC supported but never fired yet → currentTime fallback until the first callback', () => {
    const v = rvfcVideo(1);
    const t = new VideoFrameTracker(asVideo(v));
    expect(t.consumeNewFrame()).toBe(true);
    expect(t.consumeNewFrame()).toBe(false);
    v.currentTime = 2;
    expect(t.consumeNewFrame()).toBe(true);
    v.present(); // from now on rVFC decides
    expect(t.consumeNewFrame()).toBe(true);
    v.currentTime = 3;
    expect(t.consumeNewFrame()).toBe(false);
  });

  it('rVFC unsupported → currentTime fallback (cannot detect frozen MediaStream frames, only a stopped element)', () => {
    const v = { currentTime: 5 };
    const t = new VideoFrameTracker(asVideo(v));
    expect(t.consumeNewFrame()).toBe(true);
    v.currentTime = 5.5;
    expect(t.consumeNewFrame()).toBe(true);
    expect(t.consumeNewFrame()).toBe(false);
  });
});
