'use client';
import { memo, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { ErrorBanner } from '@/components/ErrorBanner';
import { joinErrorMessage } from '@/components/authErrors';
import { LoadingState, Spinner } from '@/components/Skeleton';
import { displayInviteCode, normalizeInviteCode } from './inviteCode';
import { useMyTeachers } from './useMyTeachers';

export interface TeacherConnectCardProps {
  /**
   * `full` (settings page) always renders. `prompt` (study screen) renders only for a student with
   * no teacher at first load, and stays after a join so the result is visible.
   */
  variant?: 'full' | 'prompt';
}

/**
 * Student card for linking to teachers. It never blocks studying.
 * E2E hooks: teacher-join-input / teacher-join-submit / teacher-join-error / my-teacher.
 */
export const TeacherConnectCard = memo(function TeacherConnectCard({ variant = 'full' }: TeacherConnectCardProps) {
  const { teachers, loading, error, reload, addLink } = useMyTeachers();
  const [initialTeachers, setInitialTeachers] = useState<typeof teachers>(null);
  if (initialTeachers === null && teachers !== null) setInitialTeachers(teachers);
  const [value, setValue] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const linked = teachers ?? [];
  const unlinked = teachers !== null && teachers.length === 0;
  const normalized = normalizeInviteCode(value);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    if (!normalized) {
      setJoinError('초대 코드를 입력해 주세요.');
      return;
    }

    setJoinError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const link = await api.joinTeacher(normalized);
      addLink(link);
      setValue('');
      setNotice(`${link.teacher.displayName} 선생님과 연결되었습니다.`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setJoinError('로그인이 만료되었습니다. 다시 로그인해 주세요.');
      } else {
        setJoinError(joinErrorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const prompt = variant === 'prompt';
  if (prompt && (initialTeachers === null || initialTeachers.length > 0)) return null;

  return (
    <section
      aria-labelledby="teacher-connect-title"
      className={
        prompt
          ? 'mx-auto mb-12 w-full max-w-3xl rounded-3xl bg-slate-50 p-6 sm:p-8'
          : 'border-t-2 border-slate-900 pt-6'
      }
    >
      <h2 id="teacher-connect-title" className="text-lg font-bold text-slate-900">
        {prompt ? '선생님과 연결하기' : '선생님 연결'}
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        {prompt
          ? '선생님께 받은 초대 코드를 입력하면 학습 현황이 공유됩니다.'
          : unlinked
            ? '아직 연결된 선생님이 없습니다. 선생님의 초대 코드를 입력하면 학습 현황이 연결됩니다.'
            : '다른 선생님의 초대 코드를 입력하면 추가로 연결할 수 있습니다.'}
      </p>

      {loading && teachers === null ? <LoadingState label="연결된 선생님을 확인하는 중…" /> : null}

      {error && teachers === null ? (
        <div className="mt-3">
          <ErrorBanner
            title="선생님 목록을 불러오지 못했습니다"
            message={
              error.code === 'NETWORK_ERROR' ? '서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.' : error.message
            }
            onRetry={reload}
          />
        </div>
      ) : null}

      {linked.length > 0 ? (
        <ul className="mt-3" aria-label="연결된 선생님">
          {linked.map((link) => (
            <li
              key={link.teacher.id}
              data-testid="my-teacher"
              data-teacher-id={link.teacher.id}
              className="flex items-center gap-3 border-b border-slate-100 py-3 text-sm text-slate-800"
            >
              <span
                aria-hidden="true"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700"
              >
                {link.teacher.displayName.slice(0, 1)}
              </span>
              <span className="font-semibold">{link.teacher.displayName}</span>
              <span className="text-xs text-slate-500">선생님</span>
            </li>
          ))}
        </ul>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-2">
        <label htmlFor="teacher-join-input" className={prompt ? 'sr-only' : 'block text-sm font-medium text-slate-700'}>
          초대 코드
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="teacher-join-input"
            data-testid="teacher-join-input"
            type="text"
            name="inviteCode"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(displayInviteCode(e.target.value))}
            placeholder="예: ABCD-2345"
            aria-describedby="teacher-join-help"
            aria-invalid={Boolean(joinError)}
            className="h-12 min-w-0 flex-1 rounded-full border border-slate-200 bg-white px-5 font-mono text-sm uppercase tracking-wider text-slate-900 placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus-visible:ring-4 focus-visible:ring-slate-900/5"
          />
          <button
            type="submit"
            data-testid="teacher-join-submit"
            disabled={submitting || !normalized}
            className="flex h-12 items-center justify-center gap-2 rounded-full bg-slate-900 px-6 text-sm font-bold text-white transition-colors hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
          >
            {submitting ? <Spinner className="h-4 w-4 text-white" /> : null}
            {submitting ? '연결 중…' : '연결'}
          </button>
        </div>
        <p id="teacher-join-help" className="text-xs text-slate-500">
          {prompt ? '연결하지 않아도 바로 공부할 수 있습니다.' : '공백과 ‘-’는 자동으로 무시됩니다.'}
        </p>
        <div aria-live="polite">
          {joinError ? (
            <p
              data-testid="teacher-join-error"
              role="alert"
              className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700"
            >
              {joinError}
            </p>
          ) : notice ? (
            <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>
          ) : null}
        </div>
      </form>
    </section>
  );
});
