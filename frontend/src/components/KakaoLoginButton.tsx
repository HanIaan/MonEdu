'use client';
import { memo, useEffect, useState } from 'react';
import { KAKAO_START_URL, api } from '@/lib/api';

function KakaoSymbol() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-4.5 w-4.5 text-black">
      <path d="M12 3C6.9 3 3 6.1 3 9.9c0 2.4 1.6 4.6 4.1 5.9-.2.7-.8 2.6-.9 3-.1.5.2.6.4.4.3-.2 3-2 3.5-2.3.6.1 1.2.2 1.9.2 5.1 0 9-3.1 9-6.9S17.1 3 12 3Z" />
    </svg>
  );
}

/**
 * Kakao login entry point. Rendered only when the server reports Kakao is configured
 * (`GET /auth/providers`). The button navigates the whole page to the start URL — never fetch it,
 * because the server answers with a 302 to Kakao (docs/contracts/auth.md §4).
 */
export const KakaoLoginButton = memo(function KakaoLoginButton() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const providers = await api.getAuthProviders();
        if (!cancelled) setEnabled(providers.kakao);
      } catch {
        // Providers are optional chrome; a failure must not break email login.
        if (!cancelled) setEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!enabled) return null;

  return (
    <div className="space-y-4">
      <div aria-hidden="true" className="flex items-center gap-3 text-xs text-slate-400">
        <span className="h-px flex-1 bg-slate-200" />
        또는
        <span className="h-px flex-1 bg-slate-200" />
      </div>
      <button
        type="button"
        data-testid="login-kakao"
        onClick={() => window.location.assign(KAKAO_START_URL)}
        className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-black shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        style={{ backgroundColor: '#FEE500' }}
      >
        <KakaoSymbol />
        카카오 로그인
      </button>
    </div>
  );
});
