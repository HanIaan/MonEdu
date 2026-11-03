'use client';
import { useTeacherStudents } from './useTeacherStudents';
import { TeacherStudentsView } from './TeacherStudentsView';

export function TeacherScreen() {
  const { data, loading, error, refresh } = useTeacherStudents();
  return <TeacherStudentsView students={data} loading={loading} error={error} onRetry={refresh} />;
}
