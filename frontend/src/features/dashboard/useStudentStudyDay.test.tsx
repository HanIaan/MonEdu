import { act, render, renderHook, screen } from '@testing-library/react';
import { api, type StreamHandlers } from '@/lib/api';
import { makeReport } from './testFixtures';
import { useStudentStudyDay } from './useStudentStudyDay';
import { StudentDetailView } from './StudentDetailView';

const stream = vi.hoisted(() => ({ handlers: null as StreamHandlers | null, unsubscribe: vi.fn() }));
vi.mock('@/lib/api', async (original) => ({
  ...await original<typeof import('@/lib/api')>(),
  subscribeStream: vi.fn((_path: string, handlers: StreamHandlers) => {
    stream.handlers = handlers;
    return stream.unsubscribe;
  }),
}));

describe('teacher student detail refresh', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('shows a new break in both the timeline and history after the teacher stream event', async () => {
    vi.useFakeTimers();
    const before = makeReport();
    const after = makeReport({
      currentState: 'BREAK',
      intervals: [
        ...before.intervals.map((i) => i.open ? { ...i, open: false, endedAt: before.computedAt } : i),
        { id: 'break', sessionId: 'session-1', state: 'BREAK', reason: 'BREAK_STARTED',
          startedAt: before.computedAt, endedAt: null, durationSeconds: 0, open: true },
      ],
    });
    const fetch = vi.spyOn(api, 'getStudentStudyDay').mockResolvedValueOnce(before).mockResolvedValue(after);
    function Detail() {
      const { data, loading, error, refresh } = useStudentStudyDay('student-1', before.date);
      return <StudentDetailView studentId="student-1" date={before.date} report={data}
        loading={loading} error={error} onRetry={refresh} onDateChange={() => {}} />;
    }
    render(<Detail />);
    await act(async () => {});
    expect(screen.getAllByTestId('timeline-segment').at(-1)).toHaveAttribute('data-state', 'FOCUS_ESTIMATED');
    act(() => stream.handlers!.onEvent({ type: 'STATE_CHANGED', studentId: 'student-1',
      sessionId: 'session-1', state: 'BREAK', reason: 'BREAK_STARTED', at: before.computedAt }));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getAllByTestId('timeline-segment').at(-1)).toHaveAttribute('data-state', 'BREAK');
    expect(screen.getAllByTestId('session-activity').at(-1)?.querySelector('[data-state]'))
      .toHaveAttribute('data-state', 'BREAK');
  });

  it('updates ended sessions and activity from SSE before the 30-second poll', async () => {
    vi.useFakeTimers();
    const before = makeReport();
    const after = makeReport({
      activeSessionId: null,
      currentState: null,
      sessions: [{ ...before.sessions[0]!, status: 'ENDED', endedAt: before.computedAt, endReason: 'SESSION_ENDED' }],
      intervals: before.intervals.map((interval) => interval.open ? { ...interval, open: false, endedAt: before.computedAt } : interval),
    });
    const fetch = vi.spyOn(api, 'getStudentStudyDay').mockResolvedValueOnce(before).mockResolvedValue(after);
    const { result, unmount } = renderHook(() => useStudentStudyDay('student-1', before.date));
    await act(async () => {});
    expect(result.current.data?.sessions[0]?.status).toBe('ACTIVE');
    act(() => stream.handlers!.onEvent({
      type: 'SESSION_ENDED', studentId: 'student-1', sessionId: 'session-1',
      state: 'FOCUS_ESTIMATED', reason: 'SESSION_ENDED', at: before.computedAt,
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.current.data?.sessions[0]?.status).toBe('ENDED');
    expect(result.current.data?.intervals.at(-1)?.open).toBe(false);
    await act(async () => { stream.handlers!.onOpen?.(); });
    expect(fetch).toHaveBeenCalledTimes(3);
    unmount();
    expect(stream.unsubscribe).toHaveBeenCalled();
  });
});
