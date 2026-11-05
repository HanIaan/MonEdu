import { act, renderHook, waitFor } from '@testing-library/react';
import { useAsyncData } from './useAsyncData';

interface Deferred<T> {
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

function makeFetcher() {
  const pending: Deferred<string>[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetcher = vi.fn(
    () =>
      new Promise<string>((resolve, reject) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        pending.push({
          resolve: (value) => {
            inFlight -= 1;
            resolve(value);
          },
          reject: (err) => {
            inFlight -= 1;
            reject(err);
          },
        });
      }),
  );
  return { fetcher, pending, maxInFlight: () => maxInFlight };
}

describe('useAsyncData concurrency', () => {
  it('releases a hung request at the deadline and applies a queued fresh report', async () => {
    vi.useFakeTimers();
    try {
      let firstSignal: AbortSignal | undefined;
      let finishOld: (value: string) => void = () => {};
      const fetcher = vi.fn((signal: AbortSignal) => {
        if (fetcher.mock.calls.length === 1) {
          firstSignal = signal;
          return new Promise<string>((resolve) => { finishOld = resolve; });
        }
        return Promise.resolve('fresh report');
      });
      const { result, unmount } = renderHook(() => useAsyncData(fetcher, { key: 'teacher', timeoutMs: 1000 }));
      act(() => result.current.refresh());
      expect(fetcher).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(firstSignal?.aborted).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(result.current.data).toBe('fresh report');
      await act(async () => { finishOld('stale report'); });
      expect(result.current.data).toBe('fresh report');
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('exposes a request timeout without remaining in loading forever', async () => {
    vi.useFakeTimers();
    try {
      const { result, unmount } = renderHook(() => useAsyncData(() => new Promise<string>(() => {}), { key: 'stalled', timeoutMs: 1000 }));
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(result.current.loading).toBe(false);
      expect(result.current.error?.code).toBe('NETWORK_ERROR');
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshes immediately when returning to the page or reconnecting', async () => {
    const fetcher = vi.fn(async () => 'fresh');
    const { unmount } = renderHook(() => useAsyncData(fetcher, { key: 'resume' }));
    await act(async () => {});
    for (const event of ['focus', 'online']) {
      await act(async () => { window.dispatchEvent(new Event(event)); });
    }
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(fetcher).toHaveBeenCalledTimes(4);
    unmount();
    window.dispatchEvent(new Event('focus'));
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('coalesces refreshes during an in-flight request into one trailing reload', async () => {
    const { fetcher, pending, maxInFlight } = makeFetcher();
    const { result } = renderHook(() => useAsyncData<string>(fetcher, { key: 'me', refreshMs: 0 }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    // A burst of SSE refreshes while the first request is still running.
    act(() => {
      result.current.refresh();
      result.current.refresh();
      result.current.refresh();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending[0]!.resolve('first');
      await Promise.resolve();
    });

    // Exactly one trailing reload was queued — not three.
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    await act(async () => {
      pending[1]!.resolve('second');
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.data).toBe('second'));

    expect(maxInFlight()).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps the previous data visible while a refresh is in flight', async () => {
    const { fetcher, pending } = makeFetcher();
    const { result } = renderHook(() => useAsyncData<string>(fetcher, { key: 'me', refreshMs: 0 }));

    await act(async () => {
      pending[0]!.resolve('first');
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.data).toBe('first'));

    act(() => result.current.refresh());
    expect(result.current.data).toBe('first');
    expect(result.current.loading).toBe(false);

    await act(async () => {
      pending[1]!.resolve('second');
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.data).toBe('second'));
  });

  it('keeps the last data on failure and exposes the error', async () => {
    const { fetcher, pending } = makeFetcher();
    const { result } = renderHook(() => useAsyncData<string>(fetcher, { key: 'me', refreshMs: 0 }));

    await act(async () => {
      pending[0]!.resolve('first');
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.data).toBe('first'));

    act(() => result.current.refresh());
    await act(async () => {
      pending[1]!.reject(new Error('boom'));
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.error?.message).toBe('boom'));
    expect(result.current.data).toBe('first');
    expect(result.current.loading).toBe(false);
  });

  it('resets and refetches when the key changes', async () => {
    const { fetcher, pending } = makeFetcher();
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useAsyncData<string>(fetcher, { key, refreshMs: 0 }),
      { initialProps: { key: 'a' } },
    );

    await act(async () => {
      pending[0]!.resolve('a-data');
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.data).toBe('a-data'));

    rerender({ key: 'b' });
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    await act(async () => {
      pending[1]!.resolve('b-data');
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.data).toBe('b-data'));
  });
});
