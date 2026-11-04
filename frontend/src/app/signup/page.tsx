import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthLayout } from '@/components/AuthLayout';
import { SignupForm } from '@/components/SignupForm';

export const metadata: Metadata = {
  title: '회원가입 — MonEdu',
};

export default function SignupPage() {
  return (
    <AuthLayout title="회원가입" lead="학생과 선생님 모두 가입할 수 있어요." wide>
      <SignupForm />
      <p className="mt-8 text-sm text-slate-500">
        이미 계정이 있으신가요?{' '}
        <Link href="/login" className="font-bold text-slate-900 underline underline-offset-2 hover:text-slate-600">
          로그인
        </Link>
      </p>
    </AuthLayout>
  );
}
