'use client';
import { api, type TeacherStudentOverview } from '@/lib/api';
import { useAsyncData, type AsyncData } from './useAsyncData';
import { useCoalescedStreamRefresh } from './useCoalescedStreamRefresh';

/**
 * Assigned students with live status and today's summary.
 *
 * A student linked after this page was opened must appear without a re-login, so the list
 * refetches on a single SSE burst (trailing ~400 ms), on stream (re)connect, every 60 s as a
 * fallback, and whenever the window regains focus (the teacher may be returning from another app).
 */
export function useTeacherStudents(): AsyncData<TeacherStudentOverview[]> {
  const { refresh, ...rest } = useAsyncData<TeacherStudentOverview[]>(
    (signal) => api.listMyStudents({ signal }),
    { key: 'teacher:students', refreshMs: 60_000 },
  );

  useCoalescedStreamRefresh('/api/v1/teacher/stream', refresh);

  return { ...rest, refresh };
}
