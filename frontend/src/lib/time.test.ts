import { formatDuration, formatSeoulTime, nowMs, seoulDate } from './time';

describe('event wall clock after system sleep', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([2245, 3348, 7076])('includes a %s-second sleep even if performance time did not advance', (seconds) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const origin = Date.parse('2026-11-07T00:00:00Z');
    vi.setSystemTime(origin);
    let elapsed = 1000;
    vi.stubGlobal('performance', { timeOrigin: origin, now: () => elapsed });
    vi.setSystemTime(origin + elapsed);
    expect(nowMs()).toBe(Date.now());
    vi.setSystemTime(origin + elapsed + seconds * 1000);
    expect(nowMs()).toBe(Date.now());
    expect(new Date(nowMs()).toISOString()).toBe(new Date(Date.now()).toISOString());
    elapsed += 1000;
    vi.setSystemTime(Date.now() + 1000);
    expect(nowMs()).toBe(Date.now());
  });

  it('continues to follow the wall clock over repeated sleeps in the same page', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const origin = Date.parse('2026-11-07T00:00:00Z');
    vi.stubGlobal('performance', { timeOrigin: origin, now: () => 1000 });
    for (const offset of [1000, 2_246_000, 3_349_000, 7_077_000]) {
      vi.setSystemTime(origin + offset);
      expect(nowMs()).toBe(origin + offset);
    }
  });
});

describe('time helpers', () => {
  it('maps UTC instants to Asia/Seoul dates', () => {
    expect(seoulDate(new Date('2026-11-02T15:00:00Z'))).toBe('2026-11-03');
    expect(seoulDate(new Date('2026-11-02T14:59:59Z'))).toBe('2026-11-02');
  });
  it('formats Seoul wall time', () => {
    expect(formatSeoulTime('2026-11-03T00:13:22Z')).toBe('09:13:22');
  });
  it('formats durations', () => {
    expect(formatDuration(802)).toBe('13분 22초');
    expect(formatDuration(3725, true)).toBe('1:02:05');
    expect(formatDuration(null)).toBe('—');
  });
});
