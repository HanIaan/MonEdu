import { AppShell } from '@/components/AppShell';
import { RequireRole } from '@/components/RequireRole';
import { StudentDetailScreen } from '@/features/dashboard/StudentDetailScreen';
import { seoulDate } from '@/lib/time';

interface PageProps {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ date?: string | string[] }>;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export default async function StudentDetailPage({ params, searchParams }: PageProps) {
  const { studentId } = await params;
  const query = await searchParams;
  const rawDate = Array.isArray(query.date) ? query.date[0] : query.date;
  const date = rawDate && DATE_PATTERN.test(rawDate) ? rawDate : seoulDate();

  return (
    <RequireRole role="TEACHER">
      <AppShell>
        <StudentDetailScreen studentId={studentId} date={date} />
      </AppShell>
    </RequireRole>
  );
}
