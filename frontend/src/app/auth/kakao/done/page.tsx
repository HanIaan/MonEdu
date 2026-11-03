'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/api/auth';
import { homeForRole } from '@/components/roles';
import { FullPageLoading } from '@/components/Skeleton';

/**
 * Landing point after a Kakao login for an existing account. The refresh cookie was set by the
 * server; we exchange it for an in-memory access token and route by role (auth.md §4 step 4).
 */
export default function KakaoDonePage() {
  const { restoreSession } = useAuth();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const user = await restoreSession();
      if (cancelled) return;
      router.replace(user ? homeForRole(user.role) : '/login?error=kakao_failed');
    })();
    return () => {
      cancelled = true;
    };
  }, [restoreSession, router]);

  return <FullPageLoading label="카카오 로그인을 마무리하는 중…" />;
}
