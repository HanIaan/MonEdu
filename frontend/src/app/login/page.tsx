'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { useAuth } from '@/lib/api/auth';
import { AuthLayout } from '@/components/AuthLayout';
import { KakaoLoginButton } from '@/components/KakaoLoginButton';
import { LoginForm } from '@/components/LoginForm';
import { homeForRole } from '@/components/roles';

const NOTICES: Record<string, string> = {
  kakao_cancelled: '카카오 로그인이 취소되었습니다.',
  kakao_failed: '카카오 로그인에 실패했습니다. 다시 시도해 주세요.',
};

function LoginPageContent() {
  const { status, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorParam = searchParams.get('error');
  const notice = errorParam ? (NOTICES[errorParam] ?? null) : null;
  const deleted = searchParams.get('deleted') === '1';

  useEffect(() => {
    if (status === 'authenticated' && user) router.replace(homeForRole(user.role));
  }, [status, user, router]);

  return (
    <AuthLayout title="로그인" lead="다시 오신 걸 환영해요.">
      {deleted ? (
        <p role="status" className="mb-6 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          회원 탈퇴가 완료되었어요. 그동안 이용해 주셔서 감사합니다.
        </p>
      ) : null}

      <div className="space-y-6">
        <LoginForm notice={notice} />
        <KakaoLoginButton />
      </div>

      {process.env.NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS === '1' ? (
        <div
          data-testid="demo-accounts"
          className="mt-8 rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-600"
        >
          <p className="font-semibold text-slate-800">데모 계정</p>
          <p className="mt-1">
            학생 <code className="rounded bg-white px-1 py-0.5 text-slate-800">student1@demo.local</code>
            <span className="mx-1.5 text-slate-400">/</span>
            교사 <code className="rounded bg-white px-1 py-0.5 text-slate-800">teacher@demo.local</code>
          </p>
          <p className="mt-1">
            비밀번호 <code className="rounded bg-white px-1 py-0.5 text-slate-800">demo1234!</code>
          </p>
        </div>
      ) : null}
    </AuthLayout>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-screen place-items-center bg-white px-4 text-sm text-slate-500" role="status">
          불러오는 중…
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
