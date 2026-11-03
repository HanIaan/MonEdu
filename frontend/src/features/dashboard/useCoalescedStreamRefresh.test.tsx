import { act, renderHook } from '@testing-library/react';
import type { StreamHandlers, StreamPath } from '@/lib/api';
import { useCoalescedStreamRefresh } from './useCoalescedStreamRefresh';

const stream = vi.hoisted(() => ({
  path: null as StreamPath | null,
  handlers: null as StreamHandlers | null,
  unsubscribed: false,
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    subscribeStream: (path: StreamPath, handlers: StreamHandlers) => {
      stream.path = path;
      stream.handlers = handlers;
      stream.unsubscribed = false;
      return () => {
        stream.unsubscribed = true;
      };
    },
  };
});

describe('useCoalescedStreamRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stream.path = null;
    stream.handlers = null;
    stream.unsubscribed = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribes to the given stream path and unsubscribes on unmount', () => {
    const refresh = vi.fn();
    const { unmount } = renderHook(() => useCoalescedStreamRefresh('/api/v1/me/stream', refresh));

    expect(stream.path).toBe('/api/v1/me/stream');
    unmount();
    expect(stream.unsubscribed).toBe(true);
  });

  it('collapses a burst of events into one trailing refetch', () => {
    const refresh = vi.fn();
    renderHook(() => useCoalescedStreamRefresh('/api/v1/teacher/stream', refresh, { debounceMs: 400 }));

    act(() => {
      for (let i = 0; i < 10; i += 1) {
        stream.handlers!.onEvent({
          type: 'STATE_CHANGED',
          studentId: 's',
          sessionId: 'sess',
          state: 'AWAY',
          reason: 'PRESENCE_LOST',
          at: new Date().toISOString(),
        });
        if (i < 9) vi.advanceTimersByTime(20);
      }
    });

    // Trailing: nothing fired while the burst was still arriving.
    expect(refresh).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(refresh).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refetches immediately on (re)connect and cancels a pending debounce', () => {
    const refresh = vi.fn();
    renderHook(() => useCoalescedStreamRefresh('/api/v1/me/stream', refresh));

    act(() => {
      stream.handlers!.onEvent({
        type: 'STATE_CHANGED',
        studentId: 's',
        sessionId: 'sess',
        state: 'AWAY',
        reason: 'PRESENCE_LOST',
        at: new Date().toISOString(),
      });
      stream.handlers!.onOpen?.();
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    // The pending trailing refetch was flushed, not duplicated.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('drops a pending refetch when unmounted', () => {
    const refresh = vi.fn();
    const { unmount } = renderHook(() => useCoalescedStreamRefresh('/api/v1/me/stream', refresh));

    act(() => {
      stream.handlers!.onEvent({
        type: 'STATE_CHANGED',
        studentId: 's',
        sessionId: 'sess',
        state: 'AWAY',
        reason: 'PRESENCE_LOST',
        at: new Date().toISOString(),
      });
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('still refetches at least every maxWait during a continuous event stream', () => {
    const refresh = vi.fn();
    // Defaults: debounceMs 400, maxWaitMs 2000.
    renderHook(() => useCoalescedStreamRefresh('/api/v1/me/stream', refresh));

    // A big class: an event every 100 ms for 5 s — always inside the trailing debounce window.
    act(() => {
      for (let elapsed = 0; elapsed < 5_000; elapsed += 100) {
        stream.handlers!.onEvent({
          type: 'STATE_CHANGED',
          studentId: 's',
          sessionId: 'sess',
          state: 'AWAY',
          reason: 'PRESENCE_LOST',
          at: new Date().toISOString(),
        });
        vi.advanceTimersByTime(100);
      }
    });

    // Pure trailing debounce would yield 0 refetches here. maxWait forces one per 2 s.
    expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(refresh.mock.calls.length).toBe(2);

    // Once the stream stops, the trailing debounce still fires once for the tail.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(refresh.mock.calls.length).toBe(3);
  });

  it('honours a custom maxWait', () => {
    const refresh = vi.fn();
    renderHook(() => useCoalescedStreamRefresh('/api/v1/me/stream', refresh, { maxWaitMs: 1_000 }));

    act(() => {
      for (let elapsed = 0; elapsed < 5_000; elapsed += 100) {
        stream.handlers!.onEvent({
          type: 'STATE_CHANGED',
          studentId: 's',
          sessionId: 'sess',
          state: 'AWAY',
          reason: 'PRESENCE_LOST',
          at: new Date().toISOString(),
        });
        vi.advanceTimersByTime(100);
      }
    });

    expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(5);
  });
});
