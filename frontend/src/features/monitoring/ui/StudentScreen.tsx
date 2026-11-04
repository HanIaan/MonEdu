'use client';
import { TeacherConnectCard } from '@/features/account/TeacherConnectCard';
import { useStudySession } from '@/features/monitoring/session';
import { useStudyDay } from '@/features/dashboard/useStudyDay';
import { seoulDate } from '@/lib/time';
import { StudentStudyScreen } from './StudentStudyScreen';

/** Page-level wiring: teacher linking, one hook call for the session engine and one for the day report. */
export function StudentScreen() {
  const session = useStudySession();
  const day = useStudyDay(seoulDate());

  return (
    <div className="space-y-6">
      <TeacherConnectCard />
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
