'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { useAuth } from '@/lib/api/auth';
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

  useEffect(() => {
    if (status === 'authenticated' && user) router.replace(homeForRole(user.role));
  }, [status, user, router]);

  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6">
              <path d="M3.5 12s3.2-5.5 8.5-5.5S20.5 12 20.5 12 17.3 17.5 12 17.5 3.5 12 3.5 12Z" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="12" r="2.4" />
            </svg>
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">Study Monitor</h1>
          <p className="mt-1 text-sm text-slate-500">학습 모니터링에 로그인하세요.</p>
        </div>

        <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <LoginForm notice={notice} />
          <KakaoLoginButton />
        </div>

        {process.env.NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS === '1' ? (
          <div
            data-testid="demo-accounts"
            className="mt-5 rounded-xl border border-slate-200 bg-slate-100/70 px-4 py-3 text-xs leading-relaxed text-slate-600"
          >
            <p className="font-medium text-slate-700">데모 계정</p>
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

        <p className="mt-6 text-center text-xs text-slate-500">
          <Link href="/privacy" className="underline underline-offset-2 hover:text-slate-700">
            개인정보 처리 안내
          </Link>
          <span className="mx-2 text-slate-300">·</span>
          영상은 브라우저 안에서만 분석되며 전송·저장되지 않습니다.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-screen place-items-center bg-slate-50 px-4 text-sm text-slate-500" role="status">
          불러오는 중…
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
