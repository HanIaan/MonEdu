'use client';
import { InviteCodeCard } from './InviteCodeCard';
import { useTeacherStudents } from './useTeacherStudents';
import { TeacherStudentsView } from './TeacherStudentsView';

export function TeacherScreen() {
  const { data, loading, error, refresh } = useTeacherStudents();
  return (
    <div className="space-y-6">
      <InviteCodeCard />
      <TeacherStudentsView students={data} loading={loading} error={error} onRetry={refresh} />
    </div>
  );
}
