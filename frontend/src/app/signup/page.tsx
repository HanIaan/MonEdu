import type { Metadata } from 'next';
import Link from 'next/link';
import { SignupForm } from '@/components/SignupForm';

export const metadata: Metadata = {
  title: '회원가입 — Study Monitor',
};

export default function SignupPage() {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-md text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-900"
          >
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                <path d="M3.5 12s3.2-5.5 8.5-5.5S20.5 12 20.5 12 17.3 17.5 12 17.5 3.5 12 3.5 12Z" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="12" cy="12" r="2.4" />
              </svg>
            </span>
            <span className="text-xl font-semibold tracking-tight">Study Monitor</span>
          </Link>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">회원가입</h1>
          <p className="mt-1 text-sm text-slate-500">학생과 선생님 모두 가입할 수 있습니다.</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <SignupForm />
        </div>

        <p className="mt-5 text-center text-sm text-slate-600">
          이미 계정이 있으신가요?{' '}
          <Link href="/login" className="font-medium text-slate-900 underline underline-offset-2 hover:text-slate-700">
            로그인
          </Link>
        </p>

        <p className="mt-6 text-center text-xs leading-relaxed text-slate-500">
          영상은 브라우저 안에서만 분석되며 전송·저장되지 않습니다.
          <span className="mx-2 text-slate-300">·</span>
          <Link href="/privacy" className="underline underline-offset-2 hover:text-slate-700">
            개인정보 처리 안내
          </Link>
        </p>
      </div>
    </div>
  );
}
