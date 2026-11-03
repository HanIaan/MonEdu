'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';

export interface AsyncData<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  /** Client receipt time (epoch ms) of the latest successful fetch — used to tick live values. */
  fetchedAt: number | null;
  refresh: () => void;
}

export interface AsyncDataOptions {
  /** Identity of the request; changing it resets state and refetches. */
  key: string;
  /** Poll interval in ms. 0 disables polling. */
  refreshMs?: number;
}

function asApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  return new ApiError(0, 'UNKNOWN', err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
}

/**
 * Small fetch/poll state machine used by dashboard hooks.
 * Refreshes keep the previous data visible (no skeleton flash); failures keep the last data.
 */
export function useAsyncData<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  { key, refreshMs = 0 }: AsyncDataOptions,
): AsyncData<T> {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const [state, setState] = useState<{
    data: T | null;
    error: ApiError | null;
    loading: boolean;
    fetchedAt: number | null;
  }>({ data: null, error: null, loading: true, fetchedAt: null });
  const [nonce, setNonce] = useState(0);
  const keyRef = useRef(key);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (keyRef.current !== key) {
      keyRef.current = key;
      setState({ data: null, error: null, loading: true, fetchedAt: null });
    }

    const controller = new AbortController();
    let cancelled = false;

    const load = async () => {
      try {
        const result = await fetcherRef.current(controller.signal);
        if (cancelled) return;
        setState({ data: result, error: null, loading: false, fetchedAt: Date.now() });
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setState((prev) => ({ ...prev, error: asApiError(err), loading: false }));
      }
    };

    void load();
    const timer = refreshMs > 0 ? setInterval(() => void load(), refreshMs) : null;

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [key, refreshMs, nonce]);

  return { ...state, refresh };
}
