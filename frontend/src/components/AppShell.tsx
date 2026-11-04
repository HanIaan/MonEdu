'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { MouseEvent, ReactNode } from 'react';
import { useAuth } from '@/lib/api/auth';
import { homeForRole, roleLabel } from './roles';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';

interface NavItem {
  href: string;
  label: string;
}

function navItemsFor(role: 'STUDENT' | 'TEACHER' | null): NavItem[] {
  if (role === 'STUDENT') {
    return [
      { href: '/student', label: '학습' },
      { href: '/student/guide', label: '가이드' },
      { href: '/student/settings', label: '설정' },
    ];
  }
  if (role === 'TEACHER') {
    return [
      { href: '/teacher', label: '학생 관리' },
      { href: '/teacher/settings', label: '설정' },
    ];
  }
  return [];
}


/** Leaving the study screen unmounts the session and stops the camera; ask first. */
function confirmLeaveStudy(event: MouseEvent<HTMLAnchorElement>, href: string, pathname: string) {
  if (pathname !== '/student' || href === '/student') return;
  if (typeof document === 'undefined' || document.body.dataset.studyActive !== '1') return;
  if (!window.confirm('이 화면을 떠나면 카메라가 꺼지고 측정이 멈춥니다. 이동할까요?')) event.preventDefault();
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
  /** The study screen carries its own single privacy line at the bottom, so it hides this footer. */
  footer?: boolean;
}

/**
 * Authenticated (and public) page chrome: brand, role nav, signed-in user and logout.
 * `data-testid="logout"` is part of the E2E contract.
 */
export function AppShell({ children, title, subtitle, actions, footer = true }: AppShellProps) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const items = navItemsFor(user?.role ?? null);

  const handleLogout = () => {
    // Await the server-side revoke before leaving, so the refresh cookie is cleared too.
    void logout().finally(() => router.replace('/login'));
  };

  const navLink = (item: NavItem, extra = '') =>
    `${extra} text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-900 ${
      isActive(pathname, item.href) ? 'text-slate-900' : 'text-slate-500 hover:text-slate-900'
    }`;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-8 px-5 sm:px-8">
          <Link
            href={homeForRole(user?.role)}
            className="flex items-center gap-2.5 rounded-md text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-900"
          >
            <Logo markClassName="h-7 w-7" />
          </Link>

          {items.length > 0 ? (
            <nav aria-label="주요 메뉴" className="hidden items-center gap-6 md:flex">
              {items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={(event) => confirmLeaveStudy(event, item.href, pathname)}
                  aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                  className={navLink(item)}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          ) : null}

          <div className="ml-auto flex items-center gap-1">
            {user ? (
              <span className="mr-2 hidden text-sm text-slate-500 sm:block">
                <span className="font-semibold text-slate-900">{user.displayName}</span> {roleLabel(user.role)}
              </span>
            ) : null}
            <ThemeToggle />
            {user ? (
              <button
                type="button"
                data-testid="logout"
                onClick={handleLogout}
                className="h-9 rounded-full px-3 text-sm font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              >
                로그아웃
              </button>
            ) : (
              <Link
                href="/login"
                className="flex h-9 items-center rounded-full px-3 text-sm font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                로그인
              </Link>
            )}
          </div>
        </div>

        {items.length > 1 ? (
          <nav aria-label="모바일 메뉴" className="mx-auto flex max-w-7xl gap-6 px-5 pb-3 sm:px-8 md:hidden">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={(event) => confirmLeaveStudy(event, item.href, pathname)}
                aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                className={navLink(item, 'whitespace-nowrap')}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-8 sm:px-8 lg:py-12">
        {title ? (
          <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">{title}</h1>
              {subtitle ? <p className="mt-2 max-w-2xl text-sm text-slate-500">{subtitle}</p> : null}
            </div>
            {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
          </div>
        ) : null}
        {children}
      </main>

      {footer ? (
        <footer className="border-t border-slate-100">
          <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-6 text-xs text-slate-500 sm:px-8">
            <p>
              모든 상태 표시는 자동 분석에 따른 <strong className="font-semibold text-slate-700">추정</strong>이며,
              영상은 브라우저 밖으로 나가지 않습니다.
            </p>
            <nav aria-label="정책" className="flex gap-4">
              <Link href="/privacy" className="hover:text-slate-900">
                개인정보 처리 안내
              </Link>
              <Link href="/terms" className="hover:text-slate-900">
                이용약관
              </Link>
            </nav>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
