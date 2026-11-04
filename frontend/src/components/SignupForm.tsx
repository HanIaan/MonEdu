'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import type { Role } from '@/lib/api';
import { useAuth } from '@/lib/api/auth';
import { signupErrorView } from './authErrors';
import { passwordRules } from './passwordPolicy';
import { homeForRole } from './roles';
import { Spinner } from './Skeleton';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const INPUT =
  'mt-1.5 block w-full h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus-visible:ring-4 focus-visible:ring-slate-900/5';
const LABEL = 'block text-sm font-semibold text-slate-900';

function FieldError({ field, message }: { field: string; message?: string }) {
  if (!message) return null;
  return (
    <p data-testid={`signup-error-${field}`} className="mt-1 text-xs font-medium text-rose-700">
      {message}
    </p>
  );
}

export function RoleChoice({
  role,
  onChange,
  idPrefix = 'signup',
}: {
  role: Role;
  onChange: (role: Role) => void;
  idPrefix?: string;
}) {
  const option = (value: Role, label: string, hint: string) => (
    <label
      className={`flex cursor-pointer items-start gap-2 rounded-2xl border p-4 transition-colors ${
        role === value ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white hover:bg-slate-50'
      }`}
    >
      <input
        type="radio"
        name={`${idPrefix}-role`}
        value={value}
        data-testid={`${idPrefix}-role-${value === 'STUDENT' ? 'student' : 'teacher'}`}
        checked={role === value}
        onChange={() => onChange(value)}
        className="mt-0.5 h-4 w-4 accent-slate-900"
      />
      <span>
        <span className="block text-sm font-medium text-slate-900">{label}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>
      </span>
    </label>
  );

  return (
    <fieldset>
      <legend className={LABEL}>역할</legend>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {option('STUDENT', '학생', '학습 화면을 사용합니다')}
        {option('TEACHER', '선생님', '학생 현황을 확인합니다')}
      </div>
    </fieldset>
  );
}

function PasswordHints({ password, email }: { password: string; email: string }) {
  const rules = useMemo(() => passwordRules(password, email), [password, email]);
  const touched = password.length > 0;

  return (
    <div id="signup-password-hints" data-testid="signup-password-hints" className="mt-2 rounded-2xl bg-slate-50 px-4 py-3">
      <p className="text-xs font-medium text-slate-600">비밀번호 조건</p>
      <ul className="mt-1 space-y-0.5">
        {rules.map((rule) => (
          <li
            key={rule.id}
            data-rule={rule.id}
            data-ok={rule.ok ? 'true' : 'false'}
            className={`flex items-start gap-1.5 text-xs ${
              touched ? (rule.ok ? 'text-emerald-700' : 'text-slate-500') : 'text-slate-500'
            }`}
          >
            <span aria-hidden="true" className="mt-px">
              {rule.ok ? '✓' : '○'}
            </span>
            <span>
              {rule.label}
              <span className="sr-only">{rule.ok ? ' — 충족' : ' — 미충족'}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
        흔히 쓰이는 비밀번호는 서버에서 거부됩니다.
      </p>
    </div>
  );
}

/** Email/password sign-up form (contract: docs/contracts/auth.md §1). */
export function SignupForm({ initialRole = 'STUDENT' }: { initialRole?: Role }) {
  const { signup } = useAuth();
  const router = useRouter();

  const [role, setRole] = useState<Role>(initialRole);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const rules = useMemo(() => passwordRules(password, email), [password, email]);

  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    const name = displayName.trim();
    if (name.length < 1 || name.length > 30) errors.displayName = '이름은 1–30자로 입력해 주세요.';
    if (!EMAIL_RE.test(email.trim())) errors.email = '이메일 형식을 확인해 주세요.';
    if (!rules.every((rule) => rule.ok)) errors.password = '비밀번호 조건을 모두 충족해 주세요.';
    if (password !== passwordConfirm) errors['password-confirm'] = '비밀번호가 일치하지 않습니다.';
    if (!agreeTerms) errors['agree-terms'] = '이용약관에 동의해 주세요.';
    if (!agreePrivacy) errors['agree-privacy'] = '개인정보 처리방침에 동의해 주세요.';
    return errors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const clientErrors = validate();
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      setFormError('입력 값을 확인해 주세요.');
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setSubmitting(true);
    try {
      const user = await signup({
        email: email.trim().toLowerCase(),
        password,
        displayName: displayName.trim(),
        role,
        agreements: { terms: true, privacy: true },
      });
      router.replace(homeForRole(user.role));
    } catch (err) {
      const view = signupErrorView(err);
      setFieldErrors(view.fields);
      setFormError(view.summary);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <RoleChoice role={role} onChange={setRole} />

      <div>
        <label htmlFor="signup-display-name" className={LABEL}>
          이름 <span className="font-normal text-slate-500">(표시 이름)</span>
        </label>
        <input
          id="signup-display-name"
          data-testid="signup-display-name"
          type="text"
          name="displayName"
          autoComplete="nickname"
          maxLength={30}
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          aria-invalid={Boolean(fieldErrors.displayName)}
          aria-describedby="signup-display-name-help"
          className={INPUT}
        />
        <p id="signup-display-name-help" className="mt-1 text-xs text-slate-500">
          1–30자, 선생님과 학생에게 보이는 이름입니다.
        </p>
        <FieldError field="displayName" message={fieldErrors.displayName} />
      </div>

      <div>
        <label htmlFor="signup-email" className={LABEL}>
          이메일
        </label>
        <input
          id="signup-email"
          data-testid="signup-email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          aria-invalid={Boolean(fieldErrors.email)}
          className={INPUT}
        />
        <FieldError field="email" message={fieldErrors.email} />
      </div>

      <div>
        <label htmlFor="signup-password" className={LABEL}>
          비밀번호
        </label>
        <input
          id="signup-password"
          data-testid="signup-password"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          aria-invalid={Boolean(fieldErrors.password)}
          aria-describedby="signup-password-hints"
          className={INPUT}
        />
        <PasswordHints password={password} email={email} />
        <FieldError field="password" message={fieldErrors.password} />
      </div>

      <div>
        <label htmlFor="signup-password-confirm" className={LABEL}>
          비밀번호 확인
        </label>
        <input
          id="signup-password-confirm"
          data-testid="signup-password-confirm"
          type="password"
          name="passwordConfirm"
          autoComplete="new-password"
          required
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          placeholder="••••••••"
          aria-invalid={Boolean(fieldErrors['password-confirm'])}
          className={INPUT}
        />
        <FieldError field="password-confirm" message={fieldErrors['password-confirm']} />
      </div>

      <fieldset className="space-y-2">
        <legend className="sr-only">약관 동의</legend>
        <FieldError field="agreements" message={fieldErrors.agreements} />
        <div className="flex items-start gap-2">
          <input
            id="signup-agree-terms"
            data-testid="signup-agree-terms"
            type="checkbox"
            checked={agreeTerms}
            onChange={(e) => setAgreeTerms(e.target.checked)}
            aria-describedby={fieldErrors['agree-terms'] ? 'signup-agree-terms-error' : undefined}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-slate-900"
          />
          <div className="min-w-0">
            <label htmlFor="signup-agree-terms" className="text-sm text-slate-700">
              <span className="font-medium">이용약관</span>에 동의합니다 (필수)
            </label>
            <Link
              href="/terms"
              className="ml-1 text-xs text-slate-500 underline underline-offset-2 hover:text-slate-800"
            >
              약관 보기
            </Link>
            {fieldErrors['agree-terms'] ? (
              <p id="signup-agree-terms-error" data-testid="signup-error-agree-terms" className="mt-0.5 text-xs font-medium text-rose-700">
                {fieldErrors['agree-terms']}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex items-start gap-2">
          <input
            id="signup-agree-privacy"
            data-testid="signup-agree-privacy"
            type="checkbox"
            checked={agreePrivacy}
            onChange={(e) => setAgreePrivacy(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-slate-900"
          />
          <div className="min-w-0">
            <label htmlFor="signup-agree-privacy" className="text-sm text-slate-700">
              <span className="font-medium">개인정보 처리방침</span>과 카메라 분석에 동의합니다 (필수)
              <span className="mt-0.5 block text-xs text-slate-500">
                공부할 때 카메라 영상은 브라우저 안에서만 분석되며 서버로 전송되거나 저장되지 않습니다.
              </span>
            </label>
            <Link
              href="/privacy"
              className="ml-1 text-xs text-slate-500 underline underline-offset-2 hover:text-slate-800"
            >
              방침 보기
            </Link>
            {fieldErrors['agree-privacy'] ? (
              <p id="signup-agree-privacy-error" data-testid="signup-error-agree-privacy" className="mt-0.5 text-xs font-medium text-rose-700">
                {fieldErrors['agree-privacy']}
              </p>
            ) : null}
          </div>
        </div>
      </fieldset>

      <div aria-live="polite">
        {formError ? (
          <p
            data-testid="signup-error"
            role="alert"
            className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700"
          >
            {formError}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        data-testid="signup-submit"
        disabled={submitting}
        className="flex w-full items-center justify-center gap-2 h-13 rounded-full bg-slate-900 px-6 text-base font-bold text-white transition-colors hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? <Spinner className="h-4 w-4 text-white" /> : null}
        {submitting ? '가입 중…' : '가입하기'}
      </button>
    </form>
  );
}
