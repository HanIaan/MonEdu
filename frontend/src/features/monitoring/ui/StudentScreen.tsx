'use client';
import { useStudySession } from '@/features/monitoring/session';
import { useStudyDay } from '@/features/dashboard/useStudyDay';
import { seoulDate } from '@/lib/time';
import { StudentStudyScreen } from './StudentStudyScreen';

/** Page-level wiring: one hook call for the session engine and one for the day report. */
export function StudentScreen() {
  const session = useStudySession();
  const day = useStudyDay(seoulDate());

  return (
    <StudentStudyScreen
      session={session}
      report={day.data}
      reportLoading={day.loading}
      reportError={day.error}
      fetchedAt={day.fetchedAt}
      onRefreshReport={day.refresh}
    />
  );
}
