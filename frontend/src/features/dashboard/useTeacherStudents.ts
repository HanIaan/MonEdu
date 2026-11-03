'use client';
import { useEffect } from 'react';
import { api, subscribeStream, type TeacherStudentOverview } from '@/lib/api';
import { useAsyncData, type AsyncData } from './useAsyncData';

/**
 * Assigned students with live status and today's summary.
 * Refetches on every teacher SSE event, on (re)connect, and every 30 s.
 */
export function useTeacherStudents(): AsyncData<TeacherStudentOverview[]> {
  const { refresh, ...rest } = useAsyncData<TeacherStudentOverview[]>(
    (signal) => api.listMyStudents({ signal }),
    { key: 'teacher:students', refreshMs: 30_000 },
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
    const unsubscribe = subscribeStream('/api/v1/teacher/stream', {
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
