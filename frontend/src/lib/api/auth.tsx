'use client';
/**
 * Auth context (owner: C0). Wrap the app in <AuthProvider>; use useAuth() in pages.
 * v1.3: the access token lives in memory; on load the session is restored from the HttpOnly refresh
 * cookie (POST /api/v1/auth/refresh). See docs/contracts/auth.md.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, refreshAccessToken } from './client';
import { getToken, onUnauthorized, setToken } from './token';
import type { DeleteAccountRequest, KakaoCompleteRequest, LoginResponse, SignupRequest, User } from './types';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  login(email: string, password: string): Promise<User>;
  signup(req: SignupRequest): Promise<User>;
  /** Finish a Kakao sign-up (the server holds the Kakao identity in an HttpOnly ticket cookie). */
  completeKakaoSignup(req: KakaoCompleteRequest): Promise<User>;
  /** Re-read the session from the refresh cookie (e.g. after the Kakao redirect). */
  restoreSession(): Promise<User | null>;
  /** Revokes the refresh token on the server, then clears local state. Never throws. */
  logout(): Promise<void>;
  /** Deletes the account on the server, then signs out locally. Errors (wrong password…) propagate. */
  deleteAccount(req: DeleteAccountRequest): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  const restoreSession = useCallback(async () => {
    try {
      if (!getToken() && !(await refreshAccessToken())) throw new Error('no session');
      const me = await api.getMe();
      setUser(me);
      setStatus('authenticated');
      return me;
    } catch {
      setToken(null);
      setUser(null);
      setStatus('anonymous');
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Resolve asynchronously so state is set outside render.
    void (async () => {
      const ok = !!getToken() || (await refreshAccessToken());
      if (cancelled) return;
      if (!ok) {
        setStatus('anonymous');
        return;
      }
      try {
        const me = await api.getMe();
        if (cancelled) return;
        setUser(me);
        setStatus('authenticated');
      } catch {
        if (cancelled) return;
        setToken(null);
        setStatus('anonymous');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () =>
      onUnauthorized(() => {
        setToken(null);
        setUser(null);
        setStatus('anonymous');
      }),
    [],
  );

  const accept = useCallback((res: LoginResponse) => {
    setToken(res.accessToken);
    setUser(res.user);
    setStatus('authenticated');
    return res.user;
  }, []);

  const login = useCallback(async (email: string, password: string) => accept(await api.login(email, password)), [accept]);
  const signup = useCallback(async (req: SignupRequest) => accept(await api.signup(req)), [accept]);
  const completeKakaoSignup = useCallback(
    async (req: KakaoCompleteRequest) => accept(await api.kakaoComplete(req)),
    [accept],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* offline: the cookie expires on its own; local state is cleared regardless */
    }
    setToken(null);
    setUser(null);
    setStatus('anonymous');
  }, []);

  const deleteAccount = useCallback(async (req: DeleteAccountRequest) => {
    await api.deleteMe(req);
    setToken(null);
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo(
    () => ({ status, user, login, signup, completeKakaoSignup, restoreSession, logout, deleteAccount }),
    [status, user, login, signup, completeKakaoSignup, restoreSession, logout, deleteAccount],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
