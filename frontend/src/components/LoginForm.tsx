'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/api/auth';
import { Spinner } from './Skeleton';
import { homeForRole } from './roles';

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'BAD_CREDENTIALS') return '이메일 또는 비밀번호가 올바르지 않습니다.';
    if (err.code === 'NETWORK_ERROR') return '서버에 연결할 수 없습니다. 네트워크 연결을 확인해 주세요.';
    if (err.code === 'VALIDATION_FAILED') return err.message || '입력 값을 확인해 주세요.';
    return err.message || '로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  }
  return '로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}

/** Email/password sign-in form. E2E hooks: login-email, login-password, login-submit, login-error. */
export function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(email.trim(), password);
      router.replace(homeForRole(user.role));
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <label htmlFor="login-email" className="block text-sm font-medium text-slate-700">
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
          className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20"
        />
      </div>

      <div>
        <label htmlFor="login-password" className="block text-sm font-medium text-slate-700">
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
          className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20"
        />
      </div>

      <div aria-live="polite">
        {error ? (
          <p
            data-testid="login-error"
            role="alert"
            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
          >
            {error}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        data-testid="login-submit"
        disabled={submitting || !email.trim() || !password}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {submitting ? <Spinner className="h-4 w-4 text-white" /> : null}
        {submitting ? '로그인 중…' : '로그인'}
      </button>
    </form>
  );
}
