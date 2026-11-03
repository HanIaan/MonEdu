'use client';
import { api, type TeacherStudentOverview } from '@/lib/api';
import { useAsyncData, type AsyncData } from './useAsyncData';
import { useCoalescedStreamRefresh } from './useCoalescedStreamRefresh';

/**
 * Assigned students with live status and today's summary.
 * Refetches a single time per SSE burst (trailing ~400 ms), on (re)connect, and every 30 s.
 */
export function useTeacherStudents(): AsyncData<TeacherStudentOverview[]> {
  const { refresh, ...rest } = useAsyncData<TeacherStudentOverview[]>(
    (signal) => api.listMyStudents({ signal }),
    { key: 'teacher:students', refreshMs: 30_000 },
  );

  useCoalescedStreamRefresh('/api/v1/teacher/stream', refresh);

  return { ...rest, refresh };
}
