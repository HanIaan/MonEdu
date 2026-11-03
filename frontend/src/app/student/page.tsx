'use client';
import { AppShell } from '@/components/AppShell';
import { RequireRole } from '@/components/RequireRole';
import { StudentScreen } from '@/features/monitoring/ui/StudentScreen';

export default function StudentPage() {
  return (
    <RequireRole role="STUDENT">
      <AppShell
        title="학습 화면"
        subtitle="카메라로 자리와 휴대폰 사용 신호를 분석합니다. 모든 상태는 자동 분석에 따른 추정입니다."
      >
        <StudentScreen />
      </AppShell>
    </RequireRole>
  );
}
