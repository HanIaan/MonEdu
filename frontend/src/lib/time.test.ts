import { formatDuration, formatSeoulTime, seoulDate } from './time';

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
