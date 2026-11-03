'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useAuth } from '@/lib/api/auth';
import { homeForRole, roleLabel } from './roles';

interface NavItem {
  href: string;
  label: string;
}

function navItemsFor(role: 'STUDENT' | 'TEACHER' | null): NavItem[] {
  const items: NavItem[] = [];
  if (role === 'STUDENT') items.push({ href: '/student', label: '학습 화면' });
  if (role === 'TEACHER') items.push({ href: '/teacher', label: '학생 관리' });
  items.push({ href: '/privacy', label: '개인정보 처리 안내' });
  return items;
}

function Logo() {
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4.5 w-4.5">
        <path d="M3.5 12s3.2-5.5 8.5-5.5S20.5 12 20.5 12 17.3 17.5 12 17.5 3.5 12 3.5 12Z" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="2.4" />
      </svg>
    </span>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/teacher') return pathname === '/teacher' || pathname.startsWith('/teacher/students');
  return pathname === href;
}

export interface AppShellProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
}

/**
 * Authenticated (and public) page chrome: brand, role nav, signed-in user and logout.
 * `data-testid="logout"` is part of the E2E contract.
 */
export function AppShell({ children, title, subtitle, actions }: AppShellProps) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const items = navItemsFor(user?.role ?? null);

  const handleLogout = () => {
    // Await the server-side revoke before leaving, so the refresh cookie is cleared too.
    void logout().finally(() => router.replace('/login'));
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
          <Link
            href={homeForRole(user?.role)}
            className="flex items-center gap-2 rounded-md text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-900"
          >
            <Logo />
            <span className="text-base font-semibold tracking-tight">Study Monitor</span>
          </Link>

          <nav aria-label="주요 메뉴" className="ml-2 hidden items-center gap-1 md:flex">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${
                  isActive(pathname, item.href)
                    ? 'bg-slate-100 text-slate-900'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {user ? (
              <>
                <span className="hidden text-sm text-slate-500 sm:block">
                  <span className="font-medium text-slate-800">{user.displayName}</span>
                  <span className="mx-1.5 text-slate-300">·</span>
                  {roleLabel(user.role)}
                </span>
                <button
                  type="button"
                  data-testid="logout"
                  onClick={handleLogout}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                >
                  로그아웃
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
              >
                로그인
              </Link>
            )}
          </div>
        </div>

        <nav aria-label="모바일 메뉴" className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(pathname, item.href) ? 'page' : undefined}
              className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm font-medium ${
                isActive(pathname, item.href) ? 'bg-slate-100 text-slate-900' : 'text-slate-600'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {title ? (
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
              {subtitle ? <p className="mt-1 max-w-2xl text-sm text-slate-500">{subtitle}</p> : null}
            </div>
            {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
          </div>
        ) : null}
        {children}
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto w-full max-w-7xl px-4 py-4 text-xs text-slate-500 sm:px-6 lg:px-8">
          영상은 브라우저 안에서만 분석되며 서버로 전송·저장되지 않습니다. 모든 상태 표시는 자동 분석에
          따른 <strong className="font-semibold">추정</strong>입니다.
        </div>
      </footer>
    </div>
  );
}
