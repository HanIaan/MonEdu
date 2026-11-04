import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthLayout } from '@/components/AuthLayout';
import { KakaoSignupForm } from '@/components/KakaoSignupForm';

export const metadata: Metadata = {
  title: '카카오 회원가입 — MonEdu',
};

export default function KakaoSignupPage() {
  return (
    <AuthLayout title="카카오로 가입하기" lead="역할과 이름을 확인하고 약관에 동의하면 가입이 끝나요." wide>
      <KakaoSignupForm />
      <p className="mt-8 text-sm text-slate-500">
        이미 계정이 있으신가요?{' '}
        <Link href="/login" className="font-bold text-slate-900 underline underline-offset-2 hover:text-slate-600">
          로그인
        </Link>
      </p>
    </AuthLayout>
  );
}
