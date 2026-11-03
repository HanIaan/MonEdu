'use client';
import { useEffect, useRef } from 'react';
import { subscribeStream, type StreamPath } from '@/lib/api';

export interface UseCoalescedStreamRefreshOptions {
  /**
   * Trailing debounce window. A burst of stream events inside the window collapses into a
   * single report refetch. 300–500 ms keeps the UI responsive while absorbing bursts.
   */
  debounceMs?: number;
}

/**
 * Subscribe to a monitoring SSE stream and coalesce bursts of events into one trailing refetch.
 * The fetch layer (`useAsyncData`) additionally queues at most one trailing reload while a
 * request is already in flight, so the server never sees overlapping report requests.
 *
 * A (re)connect flushes any pending debounce and refetches immediately, so events missed while
 * the stream was down do not matter.
 */
export function useCoalescedStreamRefresh(
  path: StreamPath,
  refresh: () => void,
  { debounceMs = 400 }: UseCoalescedStreamRefreshOptions = {},
): void {
  // Keep the latest refresh available without resubscribing when its identity changes.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cancel = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = () => {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        refreshRef.current();
      }, debounceMs);
    };

    const flush = () => {
      cancel();
      refreshRef.current();
    };

    const unsubscribe = subscribeStream(path, { onEvent: schedule, onOpen: flush });
    return () => {
      cancel();
      unsubscribe();
    };
  }, [path, debounceMs]);
}
