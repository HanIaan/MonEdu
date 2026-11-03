'use client';
import { useEffect, useRef } from 'react';
import { subscribeStream, type StreamPath } from '@/lib/api';

export interface UseCoalescedStreamRefreshOptions {
  /**
   * Trailing debounce window. A burst of stream events inside the window collapses into a
   * single report refetch. 300–500 ms keeps the UI responsive while absorbing bursts.
   */
  debounceMs?: number;
  /**
   * Upper bound on how long a continuous event stream may postpone a refetch. Without it, a
   * stream whose events are always spaced below `debounceMs` (a large class with many students)
   * would starve the refetch until the polling fallback. Defaults to 2 s.
   */
  maxWaitMs?: number;
}

/**
 * Subscribe to a monitoring SSE stream and coalesce bursts of events into one trailing refetch,
 * while guaranteeing at least one refetch per `maxWaitMs` during a continuous stream.
 * The fetch layer (`useAsyncData`) additionally queues at most one trailing reload while a
 * request is already in flight, so the server never sees overlapping report requests.
 *
 * A (re)connect flushes any pending timers and refetches immediately, so events missed while
 * the stream was down do not matter.
 */
export function useCoalescedStreamRefresh(
  path: StreamPath,
  refresh: () => void,
  { debounceMs = 400, maxWaitMs = 2_000 }: UseCoalescedStreamRefreshOptions = {},
): void {
  // Keep the latest refresh available without resubscribing when its identity changes.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTimers = () => {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (maxWaitTimer !== null) {
        clearTimeout(maxWaitTimer);
        maxWaitTimer = null;
      }
    };

    const fire = () => {
      clearTimers();
      refreshRef.current();
    };

    const schedule = () => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(fire, debounceMs);
      // Armed once per burst (on its first event) and never postponed by later events.
      if (maxWaitTimer === null) maxWaitTimer = setTimeout(fire, maxWaitMs);
    };

    const flush = () => fire();

    const unsubscribe = subscribeStream(path, { onEvent: schedule, onOpen: flush });
    return () => {
      clearTimers();
      unsubscribe();
    };
  }, [path, debounceMs, maxWaitMs]);
}
