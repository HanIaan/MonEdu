import type { Metadata } from 'next';
import Link from 'next/link';
import { KakaoSignupForm } from '@/components/KakaoSignupForm';

export const metadata: Metadata = {
  title: '카카오 회원가입 — Study Monitor',
};

export default function KakaoSignupPage() {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">카카오 회원가입</h1>
          <p className="mt-1 text-sm text-slate-500">
            역할과 표시 이름을 확인하고 약관에 동의하면 가입이 완료됩니다.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <KakaoSignupForm />
        </div>

        <p className="mt-5 text-center text-xs leading-relaxed text-slate-500">
          이미 계정이 있으신가요?{' '}
          <Link href="/login" className="font-medium underline underline-offset-2 hover:text-slate-700">
            로그인
          </Link>
        </p>
      </div>
    </div>
  );
}
