'use client';
import { AppShell } from '@/components/AppShell';
import { RequireRole } from '@/components/RequireRole';
import { StudentScreen } from '@/features/monitoring/ui/StudentScreen';

export default function StudentPage() {
  return (
    <RequireRole role="STUDENT">
      <AppShell footer={false}>
        <StudentScreen />
      </AppShell>
    </RequireRole>
  );
}
