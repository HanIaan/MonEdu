'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useAuth } from '@/lib/api/auth';
import { loginErrorMessage } from './authErrors';
import { Spinner } from './Skeleton';
import { homeForRole } from './roles';

export interface LoginFormProps {
  /** One-time notice (e.g. a Kakao error carried in `?error=`); cleared on submit. */
  notice?: string | null;
}

/** Email/password sign-in form. E2E hooks: login-email, login-password, login-submit, login-error. */
export function LoginForm({ notice }: LoginFormProps) {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dismissedNotice, setDismissedNotice] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const message = error ?? (dismissedNotice ? null : (notice ?? null));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setDismissedNotice(true);
    setSubmitting(true);
    try {
      const user = await login(email.trim(), password);
      router.replace(homeForRole(user.role));
    } catch (err) {
      setError(loginErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <label htmlFor="login-email" className="block text-sm font-semibold text-slate-900">
          이메일
        </label>
        <input
          id="login-email"
          data-testid="login-email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          className="mt-1.5 block w-full h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus-visible:ring-4 focus-visible:ring-slate-900/5"
        />
      </div>

      <div>
        <label htmlFor="login-password" className="block text-sm font-semibold text-slate-900">
          비밀번호
        </label>
        <input
          id="login-password"
          data-testid="login-password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="mt-1.5 block w-full h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus-visible:ring-4 focus-visible:ring-slate-900/5"
        />
      </div>

      <div aria-live="polite">
        {message ? (
          <p
            data-testid="login-error"
            role="alert"
            className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700"
          >
            {message}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        data-testid="login-submit"
        disabled={submitting || !email.trim() || !password}
        className="flex w-full items-center justify-center gap-2 h-13 rounded-full bg-slate-900 px-6 text-base font-bold text-white transition-colors hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? <Spinner className="h-4 w-4 text-white" /> : null}
        {submitting ? '로그인 중…' : '로그인'}
      </button>

      <p className="text-center text-sm text-slate-600">
        아직 계정이 없으신가요?{' '}
        <Link
          href="/signup"
          data-testid="login-signup-link"
          className="font-medium text-slate-900 underline underline-offset-2 hover:text-slate-700"
        >
          회원가입
        </Link>
      </p>
    </form>
  );
}
