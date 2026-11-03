'use client';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/lib/api/auth';
import type { Role } from '@/lib/api';
import { FullPageLoading } from './Skeleton';
import { homeForRole } from './roles';

/**
 * Client-side route guard.
 * - anonymous → /login
 * - authenticated with the wrong role → the user's own home
 * Children only mount once authorised, so page-level data hooks never fire unauthorised requests.
 */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { status, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'anonymous') {
      router.replace('/login');
      return;
    }
    if (status === 'authenticated' && user && user.role !== role) {
      router.replace(homeForRole(user.role));
    }
  }, [status, user, role, router]);

  if (status !== 'authenticated' || !user || user.role !== role) {
    return <FullPageLoading label={status === 'anonymous' ? '로그인 화면으로 이동 중…' : '불러오는 중…'} />;
  }
  return <>{children}</>;
}
