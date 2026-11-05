'use client';
import { useEffect } from 'react';
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
  const refreshDay = day.refresh;
  const { end, status, session: current } = session;
  useEffect(() => {
    // Refresh immediately after a transition acknowledgement or an explicit session end,
    // even when the SSE connection is reconnecting.
    if (current?.id) refreshDay();
  }, [current?.id, current?.lastSeq, status, refreshDay]);
  useEffect(() => {
    if (status !== 'active' || !current) return;
    if (day.data?.sessions.some((item) => item.id === current.id && item.status === 'ENDED')) {
      // Reconcile a server timeout/replacement promptly; end is idempotent for an ended session.
      void end().catch(() => undefined);
    }
  }, [day.data, current, status, end]);

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
