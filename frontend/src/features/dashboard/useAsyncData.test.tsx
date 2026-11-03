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
