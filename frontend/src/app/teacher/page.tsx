'use client';
import { AppShell } from '@/components/AppShell';
import { RequireRole } from '@/components/RequireRole';
import { TeacherScreen } from '@/features/dashboard/TeacherScreen';

export default function TeacherPage() {
  return (
    <RequireRole role="TEACHER">
      <AppShell
        title="학생 관리"
        subtitle="담당 학생의 오늘 상태와 학습 현황입니다. 모든 상태는 자동 분석에 따른 추정입니다."
      >
        <TeacherScreen />
      </AppShell>
    </RequireRole>
  );
}
