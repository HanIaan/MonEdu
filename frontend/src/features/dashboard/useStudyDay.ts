'use client';
import { api, type StudyDayReport } from '@/lib/api';
import { useAsyncData, type AsyncData } from './useAsyncData';
import { useCoalescedStreamRefresh } from './useCoalescedStreamRefresh';

/**
 * Student's own day report.
 * Refetches when the server pushes a monitoring event (notifications, not source of truth),
 * coalescing bursts into one request, on SSE (re)connect, and every 30 s as a fallback.
 */
export function useStudyDay(date: string): AsyncData<StudyDayReport> {
  const { refresh, ...rest } = useAsyncData<StudyDayReport>(
    (signal) => api.getMyStudyDay(date, { signal }),
    { key: `me:${date}`, refreshMs: 30_000 },
  );

  useCoalescedStreamRefresh('/api/v1/me/stream', refresh);

  return { ...rest, refresh };
}
