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
  /** Bound stalled requests so they cannot block every later refresh. */
  timeoutMs?: number;
}

function asApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  return new ApiError(0, 'UNKNOWN', err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
}

/**
 * Small fetch/poll state machine used by dashboard hooks.
 *
 * Concurrency contract (P2-W3 step 2): at most one request is in flight. A refresh or poll
 * request that arrives while a request is running is coalesced into a single trailing reload
 * (never more than one), so a burst of SSE events cannot fan out into overlapping fetches.
 * Refreshes keep the previous data visible (no skeleton flash); failures keep the last data.
 */
export function useAsyncData<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  { key, refreshMs = 0, timeoutMs = 15_000 }: AsyncDataOptions,
): AsyncData<T> {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const timeoutRef = useRef(timeoutMs);
  timeoutRef.current = timeoutMs;

  const [state, setState] = useState<{
    data: T | null;
    error: ApiError | null;
    loading: boolean;
    fetchedAt: number | null;
  }>({ data: null, error: null, loading: true, fetchedAt: null });

  const mountedRef = useRef(true);
  const activeRef = useRef<{ controller: AbortController; id: number } | null>(null);
  const pendingRef = useRef(false);
  const idRef = useRef(0);
  const startRef = useRef<(reset: boolean) => void>(() => {});

  const start = useCallback((reset: boolean) => {
    // Single-flight: remember that another reload is wanted and start it when this one settles.
    if (activeRef.current) {
      pendingRef.current = true;
      return;
    }
    if (reset) setState({ data: null, error: null, loading: true, fetchedAt: null });

    const id = idRef.current + 1;
    idRef.current = id;
    const controller = new AbortController();
    activeRef.current = { controller, id };

    let timedOut = false;
    let timer: ReturnType<typeof setTimeout>;
    let onAbort: () => void;
    const deadline = new Promise<never>((_, reject) => {
      onAbort = () => reject(new DOMException('Request aborted', 'AbortError'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => {
        timedOut = true;
        reject(new ApiError(0, 'NETWORK_ERROR', '서버 응답이 지연되고 있습니다. 다시 연결을 시도합니다.'));
        controller.abort();
      }, timeoutRef.current);
    });

    void (async () => {
      try {
        const result = await Promise.race([fetcherRef.current(controller.signal), deadline]);
        if (!mountedRef.current || controller.signal.aborted || activeRef.current?.id !== id) return;
        setState({ data: result, error: null, loading: false, fetchedAt: Date.now() });
      } catch (err) {
        if (!mountedRef.current || activeRef.current?.id !== id || (controller.signal.aborted && !timedOut)) return;
        setState((prev) => ({ ...prev, error: asApiError(err), loading: false }));
      } finally {
        clearTimeout(timer!);
        controller.signal.removeEventListener('abort', onAbort!);
        // Ignore completion of a superseded (aborted / key-changed) request.
        const wasActive = activeRef.current?.id === id;
        if (wasActive) activeRef.current = null;
        if (wasActive && mountedRef.current && pendingRef.current) {
          pendingRef.current = false;
          startRef.current(false);
        }
      }
    })();
  }, []);

  startRef.current = start;
  const refresh = useCallback(() => start(false), [start]);

  const keyRef = useRef(key);

  useEffect(() => {
    mountedRef.current = true;
    // Reset only when the request identity changes (the initial state is already `loading`).
    const keyChanged = keyRef.current !== key;
    keyRef.current = key;
    start(keyChanged);
    const timer = refreshMs > 0 ? setInterval(() => start(false), refreshMs) : null;
    return () => {
      if (timer) clearInterval(timer);
      // Supersede any in-flight request; its completion must not update state or trigger a reload.
      activeRef.current?.controller.abort();
      activeRef.current = null;
      pendingRef.current = false;
    };
  }, [key, refreshMs, start]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const onFocus = () => refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  return { ...state, refresh };
}
