'use client';
import Link from 'next/link';
import { ThemeSelector } from '@/components/ThemeToggle';
import { useAuth } from '@/lib/api/auth';

/** Settings sections shared by the student and teacher settings pages. */

export function ThemeSection() {
  return (
    <section aria-labelledby="theme-title" className="border-t-2 border-slate-900 pt-6">
      <h2 id="theme-title" className="text-lg font-bold text-slate-900">
        화면 테마
      </h2>
      <p className="mt-1 text-sm text-slate-500">시스템을 고르면 기기 설정을 따릅니다.</p>
      <div className="mt-4">
        <ThemeSelector />
      </div>
    </section>
  );
}

export function AccountCard() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <section aria-labelledby="account-title" className="border-t-2 border-slate-900 pt-6">
      <h2 id="account-title" className="text-lg font-bold text-slate-900">
        계정
      </h2>
      <dl className="mt-3 divide-y divide-slate-100 text-sm">
        <div className="flex justify-between gap-4 py-3">
          <dt className="text-slate-500">이름</dt>
          <dd className="font-semibold text-slate-900">{user.displayName}</dd>
        </div>
        <div className="flex justify-between gap-4 py-3">
          <dt className="text-slate-500">이메일</dt>
          <dd className="truncate font-semibold text-slate-900">{user.email ?? '카카오 계정'}</dd>
        </div>
      </dl>
    </section>
  );
}

export function PolicyLinks() {
  const item =
    'flex items-center justify-between py-3 text-sm font-semibold text-slate-900 transition-colors hover:text-slate-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';
  return (
    <nav aria-label="안내 문서" className="border-t-2 border-slate-900 pt-6">
      <h2 className="text-lg font-bold text-slate-900">안내</h2>
      <ul className="mt-3 divide-y divide-slate-100">
        <li>
          <Link href="/privacy" className={item}>
            개인정보 처리 안내{' '}
            <span aria-hidden="true" className="text-slate-400">
              ›
            </span>
          </Link>
        </li>
        <li>
          <Link href="/terms" className={item}>
            이용약관{' '}
            <span aria-hidden="true" className="text-slate-400">
              ›
            </span>
          </Link>
        </li>
      </ul>
    </nav>
  );
}
