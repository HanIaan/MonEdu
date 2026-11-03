'use client';
import { useEffect } from 'react';
import { api, subscribeStream, type StudyDayReport } from '@/lib/api';
import { useAsyncData, type AsyncData } from './useAsyncData';

/**
 * Student's own day report.
 * Refetches when the server pushes a monitoring event (notifications, not source of truth),
 * when the SSE connection (re)opens, and every 30 s as a fallback.
 */
export function useStudyDay(date: string): AsyncData<StudyDayReport> {
  const { refresh, ...rest } = useAsyncData<StudyDayReport>(
    (signal) => api.getMyStudyDay(date, { signal }),
    { key: `me:${date}`, refreshMs: 30_000 },
  );

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        refresh();
      }, 300);
    };
    const unsubscribe = subscribeStream('/api/v1/me/stream', {
      onEvent: scheduleRefresh,
      onOpen: () => refresh(),
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [refresh]);

  return { ...rest, refresh };
}
