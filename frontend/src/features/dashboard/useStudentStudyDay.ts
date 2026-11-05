'use client';
import { api, type StudyDayReport } from '@/lib/api';
import { useAsyncData, type AsyncData } from './useAsyncData';
import { useCoalescedStreamRefresh } from './useCoalescedStreamRefresh';

/** A single assigned student's report for a given Seoul date (teacher view). */
export function useStudentStudyDay(studentId: string, date: string): AsyncData<StudyDayReport> {
  const { refresh, ...rest } = useAsyncData<StudyDayReport>(
    (signal) => api.getStudentStudyDay(studentId, date, { signal }),
    { key: `teacher:${studentId}:${date}`, refreshMs: 30_000 },
  );

  useCoalescedStreamRefresh('/api/v1/teacher/stream', refresh);

  return { ...rest, refresh };
}
