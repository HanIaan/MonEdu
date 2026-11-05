import type { ActivityInterval } from '@/lib/api';

/** An open interval is only confirmed for durationSeconds, not necessarily until computedAt. */
export function activityEndMs(interval: ActivityInterval, computedAt: string | number): number {
  const start = Date.parse(interval.startedAt);
  if (interval.endedAt) return Math.max(start, Date.parse(interval.endedAt));
  const confirmed = start + Math.max(0, interval.durationSeconds) * 1000;
  const reference = typeof computedAt === 'number' ? computedAt : Date.parse(computedAt);
  return Math.max(start, Number.isFinite(reference) ? Math.min(confirmed, reference) : confirmed);
}

export function awaitingActivityConfirmation(interval: ActivityInterval, computedAt: string): boolean {
  return !interval.endedAt && Date.parse(computedAt) - activityEndMs(interval, computedAt) >= 1000;
}
