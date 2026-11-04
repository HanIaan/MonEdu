import { ApiError } from '@/lib/api';
import { joinErrorMessage, loginErrorMessage, retryAfterHint, signupErrorView } from './authErrors';

function throttled(retryAfterSec: number | null): ApiError {
  return new ApiError(429, 'TOO_MANY_ATTEMPTS', 'slow down', null, retryAfterSec);
}

describe('Retry-After copy', () => {
  it('uses minutes, rounded up, for waits of 60 s or more', () => {
    expect(retryAfterHint(throttled(60))).toBe('1분 후 다시 시도해 주세요.');
    expect(retryAfterHint(throttled(61))).toBe('2분 후 다시 시도해 주세요.');
    expect(retryAfterHint(throttled(300))).toBe('5분 후 다시 시도해 주세요.');
  });

  it('uses seconds under a minute', () => {
    expect(retryAfterHint(throttled(1))).toBe('1초 후 다시 시도해 주세요.');
    expect(retryAfterHint(throttled(45))).toBe('45초 후 다시 시도해 주세요.');
  });

  it('returns null when Retry-After is missing or unusable', () => {
    expect(retryAfterHint(throttled(null))).toBeNull();
    expect(retryAfterHint(throttled(0))).toBeNull();
    expect(retryAfterHint(new ApiError(400, 'VALIDATION_FAILED', 'bad', null, 30))).toBeNull();
  });

  it('applies the hint to sign-up, login and join messages', () => {
    const expected = '시도가 너무 많습니다. 2분 후 다시 시도해 주세요.';
    expect(signupErrorView(throttled(120)).summary).toBe(expected);
    expect(loginErrorMessage(throttled(120))).toBe(expected);
    expect(joinErrorMessage(throttled(120))).toBe(expected);
  });

  it('keeps the existing generic copy when the server sent no Retry-After', () => {
    expect(signupErrorView(throttled(null)).summary).toBe('잠시 후 다시 시도해 주세요.');
    expect(loginErrorMessage(throttled(null))).toBe('로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.');
    expect(joinErrorMessage(throttled(null))).toBe('시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.');
  });
});
