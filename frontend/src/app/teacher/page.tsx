'use client';
import { AppShell } from '@/components/AppShell';
import { RequireRole } from '@/components/RequireRole';
import { TeacherScreen } from '@/features/dashboard/TeacherScreen';

export default function TeacherPage() {
  return (
    <RequireRole role="TEACHER">
      <AppShell
        title="학생 관리"
        subtitle="담당 학생들의 오늘 공부 현황이 실시간으로 업데이트돼요."
      >
        <TeacherScreen />
      </AppShell>
    </RequireRole>
  );
}
