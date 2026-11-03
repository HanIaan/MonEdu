'use client';
import { useRouter } from 'next/navigation';
import { useStudentStudyDay } from './useStudentStudyDay';
import { StudentDetailView } from './StudentDetailView';

export function StudentDetailScreen({ studentId, date }: { studentId: string; date: string }) {
  const { data, loading, error, refresh } = useStudentStudyDay(studentId, date);
  const router = useRouter();

  const handleDateChange = (nextDate: string) => {
    router.replace(`/teacher/students/${encodeURIComponent(studentId)}?date=${encodeURIComponent(nextDate)}`);
  };

  return (
    <StudentDetailView
      studentId={studentId}
      date={date}
      report={data}
      loading={loading}
      error={error}
      onRetry={refresh}
      onDateChange={handleDateChange}
    />
  );
}
