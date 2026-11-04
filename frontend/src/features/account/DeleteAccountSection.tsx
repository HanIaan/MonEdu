'use client';
import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { useAuth } from '@/lib/api/auth';
import { deleteAccountErrorView } from '@/components/authErrors';
import { Spinner } from '@/components/Skeleton';

const LOST_BY_ROLE: Record<'STUDENT' | 'TEACHER', string[]> = {
  STUDENT: ['지금까지의 모든 공부 기록과 시간 바', '연결된 선생님과의 연결', '로그인 정보와 계정'],
  TEACHER: ['초대 코드와 모든 학생 연결 (학생 계정과 기록은 남아요)', '로그인 정보와 계정'],
};

/**
 * Settings "회원 탈퇴" (docs/contracts/auth.md §7). Collapsed by default; password accounts re-enter
 * their password, Kakao-only accounts (no email) confirm only. On success the user is signed out
 * and sent to the login page.
 * Test hooks: delete-account-open, delete-account-password, delete-account-confirm,
 * delete-account-submit, delete-account-error.
 */
export function DeleteAccountSection() {
  const { user, deleteAccount } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; field: 'password' | null } | null>(null);
  const passwordId = useId();
  const confirmId = useId();
  const errorId = useId();

  if (!user) return null;
  const needsPassword = user.email !== null;
  const canSubmit = confirmed && !submitting && (!needsPassword || password.length > 0);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await deleteAccount(needsPassword ? { password, confirm: true } : { confirm: true });
      router.replace('/login?deleted=1');
    } catch (err) {
      setError(deleteAccountErrorView(err));
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="delete-account-title" className="border-t-2 border-slate-900 pt-6">
      <h2 id="delete-account-title" className="text-lg font-bold text-slate-900">
        회원 탈퇴
      </h2>
      <p className="mt-1 text-sm text-slate-500">탈퇴하면 계정과 기록이 바로 삭제되고 되돌릴 수 없어요.</p>

      {!open ? (
        <button
          type="button"
          data-testid="delete-account-open"
          onClick={() => setOpen(true)}
          className="mt-4 h-11 rounded-full px-5 text-sm font-bold text-rose-700 ring-1 ring-rose-200 transition-colors hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700"
        >
          탈퇴하기
        </button>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-5 rounded-3xl bg-rose-50 p-6">
          <div>
            <p className="text-sm font-bold text-rose-800">삭제되는 것</p>
            <ul className="mt-2 space-y-1 text-sm text-rose-800">
              {LOST_BY_ROLE[user.role].map((item) => (
                <li key={item}>· {item}</li>
              ))}
            </ul>
            {user.email === null ? (
              <p className="mt-2 text-xs text-rose-700">
                카카오 계정 연결은 카카오 쪽에서 따로 끊을 수 있어요. 다시 카카오로 로그인하면 새로 가입하게 돼요.
              </p>
            ) : null}
          </div>

          {needsPassword ? (
            <div>
              <label htmlFor={passwordId} className="block text-sm font-semibold text-slate-900">
                비밀번호 확인
              </label>
              <input
                id={passwordId}
                data-testid="delete-account-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={error?.field === 'password'}
                aria-describedby={error ? errorId : undefined}
                className="mt-2 h-12 w-full rounded-full border border-slate-200 bg-white px-5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus-visible:ring-4 focus-visible:ring-slate-900/5 aria-[invalid=true]:border-rose-400"
              />
            </div>
          ) : null}

          <label htmlFor={confirmId} className="flex cursor-pointer items-start gap-2.5 text-sm text-slate-800">
            <input
              id={confirmId}
              data-testid="delete-account-confirm"
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-rose-600"
            />
            위 내용을 확인했고, 계정을 삭제합니다.
          </label>

          {error ? (
            <p
              id={errorId}
              role="alert"
              data-testid="delete-account-error"
              className="text-sm font-semibold text-rose-700"
            >
              {error.message}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              data-testid="delete-account-submit"
              disabled={!canSubmit}
              className="inline-flex h-12 items-center gap-2 rounded-full bg-rose-600 px-6 text-sm font-bold text-white transition-colors hover:bg-rose-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? <Spinner className="h-4 w-4 text-white" /> : null}
              {submitting ? '삭제하는 중…' : '계정 삭제'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setPassword('');
                setConfirmed(false);
                setError(null);
              }}
              disabled={submitting}
              className="h-12 rounded-full px-5 text-sm font-bold text-slate-600 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              취소
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
