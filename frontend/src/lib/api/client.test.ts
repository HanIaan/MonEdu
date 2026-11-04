import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, refreshAccessToken } from './client';
import { getToken, onUnauthorized, setToken } from './token';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

afterEach(() => {
  vi.restoreAllMocks();
  setToken(null);
});

describe('apiFetch with refresh cookie (contract v1.3)', () => {
  it('on 401 refreshes once from the cookie and retries with the new token', async () => {
    setToken('old');
    const calls: { url: string; auth: string | null; credentials?: RequestCredentials }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push({ url, auth: new Headers(init?.headers).get('Authorization'), credentials: init?.credentials });
      if (url.endsWith('/api/v1/auth/refresh')) return json(200, { accessToken: 'new', tokenType: 'Bearer', expiresIn: 900, user: {} });
      return new Headers(init?.headers).get('Authorization') === 'Bearer new' ? json(200, { id: 'u' }) : json(401, { code: 'UNAUTHORIZED' });
    });
    await expect(api.getMe()).resolves.toEqual({ id: 'u' });
    expect(calls.map((c) => c.url.replace(/^.*\/api/, '/api'))).toEqual(['/api/v1/me', '/api/v1/auth/refresh', '/api/v1/me']);
    expect(calls[1]!.credentials).toBe('include');
    expect(calls[0]!.credentials).not.toBe('include');
    expect(getToken()).toBe('new');
  });

  it('when refresh fails, clears the token and notifies unauthorized exactly once', async () => {
    setToken('old');
    const onUnauth = vi.fn();
    const off = onUnauthorized(onUnauth);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input).endsWith('/auth/refresh') ? json(401, { code: 'UNAUTHORIZED' }) : json(401, { code: 'UNAUTHORIZED' }),
    );
    await expect(api.getMe()).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBeNull();
    expect(onUnauth).toHaveBeenCalledTimes(1);
    off();
  });

  it('concurrent 401s share one refresh request (single flight)', async () => {
    let refreshes = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/auth/refresh')) {
        refreshes++;
        await new Promise((r) => setTimeout(r, 10));
        return json(200, { accessToken: 'new', tokenType: 'Bearer', expiresIn: 900, user: {} });
      }
      return new Headers(init?.headers).get('Authorization') === 'Bearer new' ? json(200, []) : json(401, {});
    });
    await Promise.all([api.listMyTeachers(), api.listMyStudents(), api.getMe()]);
    expect(refreshes).toBe(1);
  });

  it('auth endpoints never trigger the refresh path and send cookies', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(401, { code: 'BAD_CREDENTIALS' }));
    await expect(api.login('a@b.c', 'x')).rejects.toMatchObject({ code: 'BAD_CREDENTIALS' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![1]!.credentials).toBe('include');
  });

  it('exposes Retry-After seconds on 429', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(429, { code: 'TOO_MANY_ATTEMPTS' }, { 'Retry-After': '120' }));
    const err = (await api.login('a@b.c', 'x').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.retryAfterSec).toBe(120);
  });

  it('a network failure during refresh keeps the current token', async () => {
    setToken('keep');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    await expect(refreshAccessToken()).resolves.toBe(false);
    expect(getToken()).toBe('keep');
  });
});
