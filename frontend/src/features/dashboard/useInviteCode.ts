'use client';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, type InviteCode } from '@/lib/api';

function asApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  return new ApiError(0, 'UNKNOWN', err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
}

export interface InviteCodeState {
  code: InviteCode | null;
  loading: boolean;
  error: ApiError | null;
  rotating: boolean;
  reload: () => void;
  rotate: () => Promise<InviteCode | null>;
}

/** The signed-in teacher's active invite code (docs/contracts/auth.md §5). */
export function useInviteCode(): InviteCodeState {
  const [code, setCode] = useState<InviteCode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [rotating, setRotating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      try {
        const next = await api.getInviteCode({ signal: controller.signal });
        if (cancelled) return;
        setCode(next);
        setError(null);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(asApiError(err));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [reloadKey]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  const rotate = useCallback(async () => {
    setRotating(true);
    try {
      const next = await api.rotateInviteCode();
      setCode(next);
      setError(null);
      return next;
    } catch (err) {
      setError(asApiError(err));
      return null;
    } finally {
      setRotating(false);
    }
  }, []);

  return { code, loading, error, rotating, reload, rotate };
}
