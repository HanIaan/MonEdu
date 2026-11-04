'use client';
import { TeacherConnectCard } from '@/features/account/TeacherConnectCard';
import { useStudySession } from '@/features/monitoring/session';
import { useStudyDay } from '@/features/dashboard/useStudyDay';
import { seoulDate } from '@/lib/time';
import { StudentStudyScreen } from './StudentStudyScreen';

/**
 * Page-level wiring: one hook call for the session engine and one for the day report. The teacher
 * link prompt only appears until a teacher is linked; managing links lives in /student/settings.
 */
export function StudentScreen() {
  const session = useStudySession();
  const day = useStudyDay(seoulDate());

  return (
    <div className="space-y-4">
      <TeacherConnectCard variant="prompt" />
      <StudentStudyScreen
        session={session}
        report={day.data}
        reportLoading={day.loading}
        reportError={day.error}
        fetchedAt={day.fetchedAt}
        onRefreshReport={day.refresh}
      />
    </div>
  );
}
