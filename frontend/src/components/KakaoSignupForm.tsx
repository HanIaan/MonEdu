'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import type { Role } from '@/lib/api';
import { useAuth } from '@/lib/api/auth';
import { signupErrorView } from './authErrors';
import { homeForRole } from './roles';
import { RoleChoice } from './SignupForm';
import { LoadingState, Spinner } from './Skeleton';

const INPUT =
  'mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20';
const LABEL = 'block text-sm font-medium text-slate-700';

type LoadStatus = 'loading' | 'ready' | 'expired' | 'error';

const EXPIRED_MESSAGE = '카카오 인증이 만료되었습니다. 다시 로그인해 주세요.';

/**
 * Kakao sign-up completion: the server holds the Kakao identity in an HttpOnly ticket cookie.
 * `GET /auth/kakao/pending` tells us whether that ticket is still valid and gives the nickname.
 */
export function KakaoSignupForm() {
  const { completeKakaoSignup } = useAuth();
  const router = useRouter();

  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [role, setRole] = useState<Role>('STUDENT');
  const [displayName, setDisplayName] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const pending = await api.kakaoPending();
        if (cancelled) return;
        setDisplayName(pending.nickname ?? '');
        setLoadStatus('ready');
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 401 || err.status === 404)) {
          setLoadStatus('expired');
          return;
        }
        setLoadError(err instanceof ApiError ? err.message : '카카오 정보를 불러오지 못했습니다.');
        setLoadStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadStatus === 'loading') {
    return (
      <div data-testid="kakao-signup-loading">
        <LoadingState label="카카오 정보를 확인하는 중…" />
      </div>
    );
  }

  if (loadStatus === 'expired') {
    return (
      <div
        data-testid="kakao-signup-error"
        role="alert"
        className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900"
      >
        <p className="font-medium">{EXPIRED_MESSAGE}</p>
        <p className="mt-1 text-amber-800">
          <Link href="/login" className="font-medium underline underline-offset-2 hover:text-amber-950">
            로그인 화면으로 이동
          </Link>
        </p>
      </div>
    );
  }

  if (loadStatus === 'error') {
    return (
      <div
        data-testid="kakao-signup-error"
        role="alert"
        className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-800"
      >
        <p className="font-medium">카카오 정보를 불러오지 못했습니다.</p>
        {loadError ? <p className="mt-1 text-rose-700">{loadError}</p> : null}
        <p className="mt-2">
          <Link href="/login" className="font-medium underline underline-offset-2 hover:text-rose-900">
            로그인 화면으로 이동
          </Link>
        </p>
      </div>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const name = displayName.trim();
    if (name.length < 1 || name.length > 30) {
      setFormError('이름은 1–30자로 입력해 주세요.');
      return;
    }
    if (!agreeTerms || !agreePrivacy) {
      setFormError('이용약관과 개인정보 처리방침에 동의해 주세요.');
      return;
    }

    setFormError(null);
    setSubmitting(true);
    try {
      const user = await completeKakaoSignup({
        displayName: name,
        role,
        agreements: { terms: true, privacy: true },
      });
      router.replace(homeForRole(user.role));
    } catch (err) {
      setFormError(signupErrorView(err).summary);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <RoleChoice role={role} onChange={setRole} idPrefix="kakao-signup" />

      <div>
        <label htmlFor="kakao-signup-display-name" className={LABEL}>
          이름 <span className="font-normal text-slate-500">(표시 이름)</span>
        </label>
        <input
          id="kakao-signup-display-name"
          data-testid="kakao-signup-display-name"
          type="text"
          name="displayName"
          autoComplete="nickname"
          maxLength={30}
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className={INPUT}
        />
        <p className="mt-1 text-xs text-slate-500">
          카카오 프로필 이름을 불러왔습니다. 1–30자까지 수정할 수 있습니다.
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="sr-only">약관 동의</legend>
        <div className="flex items-start gap-2">
          <input
            id="kakao-signup-agree-terms"
            data-testid="kakao-signup-agree-terms"
            type="checkbox"
            checked={agreeTerms}
            onChange={(e) => setAgreeTerms(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-slate-900"
          />
          <div className="min-w-0">
            <label htmlFor="kakao-signup-agree-terms" className="text-sm text-slate-700">
              <span className="font-medium">이용약관</span>에 동의합니다 (필수)
            </label>
            <Link href="/terms" className="ml-1 text-xs text-slate-500 underline underline-offset-2 hover:text-slate-800">
              약관 보기
            </Link>
          </div>
        </div>

        <div className="flex items-start gap-2">
          <input
            id="kakao-signup-agree-privacy"
            data-testid="kakao-signup-agree-privacy"
            type="checkbox"
            checked={agreePrivacy}
            onChange={(e) => setAgreePrivacy(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-slate-900"
          />
          <div className="min-w-0">
            <label htmlFor="kakao-signup-agree-privacy" className="text-sm text-slate-700">
              <span className="font-medium">개인정보 처리방침</span>에 동의합니다 (필수)
            </label>
            <Link href="/privacy" className="ml-1 text-xs text-slate-500 underline underline-offset-2 hover:text-slate-800">
              방침 보기
            </Link>
          </div>
        </div>
      </fieldset>

      <div aria-live="polite">
        {formError ? (
          <p
            data-testid="kakao-signup-error"
            role="alert"
            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
          >
            {formError}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        data-testid="kakao-signup-submit"
        disabled={submitting}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {submitting ? <Spinner className="h-4 w-4 text-white" /> : null}
        {submitting ? '가입 중…' : '카카오 계정으로 가입 완료'}
      </button>
    </form>
  );
}
