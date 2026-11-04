import { ApiError } from '@/lib/api';

export interface AuthErrorView {
  /** One-line message for the form-level alert. */
  summary: string | null;
  /** Per-field messages keyed by the server's field names. */
  fields: Record<string, string>;
}

const NETWORK_MESSAGE = '서버에 연결할 수 없습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.';
const THROTTLED_MESSAGE = '잠시 후 다시 시도해 주세요.';
const THROTTLED_PREFIX = '시도가 너무 많습니다.';

/**
 * Format the server's `Retry-After` (docs/contracts/auth.md §3) as a Korean wait hint.
 * Under 60 s we speak in seconds; otherwise minutes, rounded up. Null when the server did not
 * send a usable value, so callers keep their generic copy.
 */
export function retryAfterHint(err: ApiError): string | null {
  const seconds = err.retryAfterSec;
  if (err.code !== 'TOO_MANY_ATTEMPTS' || seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  if (seconds < 60) return `${Math.ceil(seconds)}초 후 다시 시도해 주세요.`;
  return `${Math.ceil(seconds / 60)}분 후 다시 시도해 주세요.`;
}

/** 429 copy: precise when `Retry-After` is known, otherwise the existing generic message. */
function throttledMessage(err: ApiError, fallback: string): string {
  const hint = retryAfterHint(err);
  return hint ? `${THROTTLED_PREFIX} ${hint}` : fallback;
}

/** Map a sign-up / Kakao sign-up failure to Korean copy (docs/contracts/auth.md §1, §3). */
export function signupErrorView(err: unknown): AuthErrorView {
  if (!(err instanceof ApiError)) {
    return { summary: '가입에 실패했습니다. 잠시 후 다시 시도해 주세요.', fields: {} };
  }

  if (err.code === 'EMAIL_TAKEN') {
    const message = '이미 가입된 이메일입니다.';
    return { summary: message, fields: { email: message } };
  }

  if (err.code === 'VALIDATION_FAILED') {
    const fields: Record<string, string> = {};
    for (const item of err.problem?.errors ?? []) {
      if (item.field && item.message) fields[item.field] = item.message;
    }
    return { summary: '입력 값을 확인해 주세요.', fields };
  }

  if (err.code === 'TOO_MANY_ATTEMPTS') {
    return { summary: throttledMessage(err, THROTTLED_MESSAGE), fields: {} };
  }

  if (err.code === 'NETWORK_ERROR') {
    return { summary: NETWORK_MESSAGE, fields: {} };
  }

  return { summary: err.message || '가입에 실패했습니다. 잠시 후 다시 시도해 주세요.', fields: {} };
}

/** Map a login failure to Korean copy, including the 429 lockout. */
export function loginErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return '로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  if (err.code === 'BAD_CREDENTIALS') return '이메일 또는 비밀번호가 올바르지 않습니다.';
  if (err.code === 'TOO_MANY_ATTEMPTS') {
    return throttledMessage(err, '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.');
  }
  if (err.code === 'NETWORK_ERROR') return NETWORK_MESSAGE;
  if (err.code === 'VALIDATION_FAILED') return err.message || '입력 값을 확인해 주세요.';
  return err.message || '로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}

/** Message for a failed invite-code join (STUDENT side). */
export function joinErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return '연결에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  if (err.code === 'INVITE_CODE_INVALID') return '유효하지 않은 초대 코드입니다.';
  if (err.code === 'TOO_MANY_ATTEMPTS') {
    return throttledMessage(err, '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.');
  }
  if (err.code === 'NETWORK_ERROR') return NETWORK_MESSAGE;
  return err.message || '연결에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}

/** Map an account-deletion failure to Korean copy; `field` marks the input to highlight. */
export function deleteAccountErrorView(err: unknown): { message: string; field: 'password' | null } {
  if (!(err instanceof ApiError)) return { message: '탈퇴하지 못했습니다. 잠시 후 다시 시도해 주세요.', field: null };
  if (err.code === 'VALIDATION_FAILED') {
    const passwordError = err.problem?.errors?.find((item) => item.field === 'password');
    if (passwordError) return { message: passwordError.message || '비밀번호가 올바르지 않습니다.', field: 'password' };
    return { message: err.message || '입력 값을 확인해 주세요.', field: null };
  }
  if (err.code === 'TOO_MANY_ATTEMPTS') {
    return { message: throttledMessage(err, '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.'), field: null };
  }
  if (err.code === 'NETWORK_ERROR') return { message: NETWORK_MESSAGE, field: null };
  return { message: err.message || '탈퇴하지 못했습니다. 잠시 후 다시 시도해 주세요.', field: null };
}
