'use client';
import { api, type StudyDayReport } from '@/lib/api';
import { useAsyncData, type AsyncData } from './useAsyncData';

/** A single assigned student's report for a given Seoul date (teacher view). */
export function useStudentStudyDay(studentId: string, date: string): AsyncData<StudyDayReport> {
  return useAsyncData<StudyDayReport>(
    (signal) => api.getStudentStudyDay(studentId, date, { signal }),
    { key: `teacher:${studentId}:${date}`, refreshMs: 30_000 },
  );
}
