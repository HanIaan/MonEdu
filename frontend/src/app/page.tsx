'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/api/auth';
import { FullPageLoading } from '@/components/Skeleton';
import { homeForRole } from '@/components/roles';

/** Role-based landing redirect: STUDENT → /student, TEACHER → /teacher, anonymous → /login. */
export default function HomePage() {
  const { status, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'anonymous') {
      router.replace('/login');
      return;
    }
    router.replace(homeForRole(user?.role));
  }, [status, user, router]);

  return <FullPageLoading label="이동 중…" />;
}
