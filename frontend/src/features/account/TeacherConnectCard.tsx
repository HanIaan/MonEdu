'use client';
import { memo, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { ErrorBanner } from '@/components/ErrorBanner';
import { joinErrorMessage } from '@/components/authErrors';
import { LoadingState, Spinner } from '@/components/Skeleton';
import { displayInviteCode, normalizeInviteCode } from './inviteCode';
import { useMyTeachers } from './useMyTeachers';

/**
 * Student card for linking to teachers. Prominent while no teacher is linked, but it never blocks
 * studying: the monitoring card below stays usable either way.
 * E2E hooks: teacher-join-input / teacher-join-submit / teacher-join-error / my-teacher.
 */
export const TeacherConnectCard = memo(function TeacherConnectCard() {
  const { teachers, loading, error, reload, addLink } = useMyTeachers();
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

  return (
    <section
      aria-labelledby="teacher-connect-title"
      className={`rounded-xl border p-5 shadow-sm ${
        unlinked ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="teacher-connect-title" className="text-base font-semibold text-slate-900">
            선생님 연결
          </h2>
          <p className={`mt-1 text-sm ${unlinked ? 'text-amber-900' : 'text-slate-600'}`}>
            {unlinked
              ? '아직 연결된 선생님이 없습니다. 선생님의 초대 코드를 입력하면 학습 현황이 연결됩니다.'
              : '연결된 선생님의 초대 코드를 입력하면 선생님을 추가로 연결할 수 있습니다.'}
          </p>
        </div>
      </div>

      {loading && teachers === null ? <LoadingState label="연결된 선생님을 확인하는 중…" /> : null}

      {error && teachers === null ? (
        <div className="mt-3">
          <ErrorBanner
            title="선생님 목록을 불러오지 못했습니다"
            message={
              error.code === 'NETWORK_ERROR'
                ? '서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.'
                : error.message
            }
            onRetry={reload}
          />
        </div>
      ) : null}

      {linked.length > 0 ? (
        <ul className="mt-3 space-y-1.5" aria-label="연결된 선생님">
          {linked.map((link) => (
            <li
              key={link.teacher.id}
              data-testid="my-teacher"
              data-teacher-id={link.teacher.id}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
            >
              <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                {link.teacher.displayName.slice(0, 1)}
              </span>
              <span className="font-medium">{link.teacher.displayName}</span>
              <span className="text-xs text-slate-500">선생님</span>
            </li>
          ))}
        </ul>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-2">
        <label htmlFor="teacher-join-input" className="block text-sm font-medium text-slate-700">
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
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm uppercase tracking-wider text-slate-900 shadow-sm placeholder:font-sans placeholder:normal-case placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20"
          />
          <button
            type="submit"
            data-testid="teacher-join-submit"
            disabled={submitting || !normalized}
            className="flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {submitting ? <Spinner className="h-4 w-4 text-white" /> : null}
            {submitting ? '연결 중…' : '연결'}
          </button>
        </div>
        <p id="teacher-join-help" className="text-xs text-slate-500">
          공백과 ‘-’는 자동으로 무시됩니다. 선생님이 연결되지 않아도 학습은 계속할 수 있습니다.
        </p>
        <div aria-live="polite">
          {joinError ? (
            <p
              data-testid="teacher-join-error"
              role="alert"
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
            >
              {joinError}
            </p>
          ) : notice ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {notice}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
});
