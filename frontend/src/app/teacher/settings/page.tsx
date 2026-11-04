'use client';
import { AppShell } from '@/components/AppShell';
import { RequireRole } from '@/components/RequireRole';
import { DeleteAccountSection } from '@/features/account/DeleteAccountSection';
import { AccountCard, PolicyLinks, ThemeSection } from '@/features/account/SettingsSections';

export default function TeacherSettingsPage() {
  return (
    <RequireRole role="TEACHER">
      <AppShell>
        <div className="mx-auto w-full max-w-3xl space-y-14">
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900">설정</h1>
          <ThemeSection />
          <AccountCard />
          <PolicyLinks />
          <DeleteAccountSection />
        </div>
      </AppShell>
    </RequireRole>
  );
}
