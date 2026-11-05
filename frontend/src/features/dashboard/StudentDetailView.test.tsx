import { fireEvent, render, screen, within } from '@testing-library/react';
import { ApiError } from '@/lib/api';
import { makeReport } from './testFixtures';
import { StudentDetailView } from './StudentDetailView';

const baseProps = {
  studentId: 'student-9',
  date: '2026-11-03',
  report: null,
  loading: false,
  error: null,
  onRetry: vi.fn(),
  onDateChange: vi.fn(),
};

describe('StudentDetailView', () => {
  it('renders a friendly access-denied page for STUDENT_NOT_ASSIGNED', () => {
    render(
      <StudentDetailView
        {...baseProps}
        error={new ApiError(403, 'STUDENT_NOT_ASSIGNED', 'not assigned')}
      />,
    );
    expect(screen.getByTestId('access-denied')).toBeInTheDocument();
    expect(screen.getByTestId('access-denied')).toHaveTextContent('접근 권한이 없습니다');
    expect(screen.queryByTestId('timeline')).not.toBeInTheDocument();
  });

  it('also denies on a bare 403', () => {
    render(<StudentDetailView {...baseProps} error={new ApiError(403, 'FORBIDDEN', 'forbidden')} />);
    expect(screen.getByTestId('access-denied')).toBeInTheDocument();
  });

  it('renders summary stats and the timeline from a report', () => {
    render(<StudentDetailView {...baseProps} report={makeReport()} />);
    expect(screen.getByText('김하늘')).toBeInTheDocument();
    expect(screen.getByTestId('focus-total')).toHaveAttribute('data-seconds', '3000');
    expect(screen.getByTestId('focus-total')).toHaveTextContent('50분 0초');
    expect(screen.getByTestId('timeline')).toBeInTheDocument();
    expect(screen.getAllByTestId('timeline-segment')).toHaveLength(3);
    expect(screen.getByTestId('date-picker')).toHaveValue('2026-11-03');
  });

  it('shows the same activity intervals in the timeline and grouped session history', () => {
    const report = makeReport();
    report.intervals[1] = { ...report.intervals[1]!, state: 'BREAK', reason: 'BREAK_STARTED' };
    render(<StudentDetailView {...baseProps} report={report} />);
    const timeline = screen.getAllByTestId('timeline-segment');
    const history = screen.getAllByTestId('session-activity');
    expect(history).toHaveLength(timeline.length);
    for (const [index, interval] of report.intervals.entries()) {
      expect(history[index]).toHaveAttribute('data-interval-id', interval.id);
      expect(history[index]!.querySelector('[data-state]')).toHaveAttribute('data-state', timeline[index]!.getAttribute('data-state'));
    }
    expect(within(history[1]!).getByText('5분 0초')).toBeInTheDocument();
    expect(within(history[1]!).getByText('휴식 시작')).toBeInTheDocument();
    expect(screen.getByTestId('session-history')).toHaveTextContent('세션 1');
    expect(screen.getByText('마지막 갱신 10:00:00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '기록 새로고침' }));
    expect(baseProps.onRetry).toHaveBeenCalled();
  });

  it('keeps activities under their own session and updates session end information', () => {
    const report = makeReport();
    report.sessions.push({ id: 'session-2', status: 'ENDED', startedAt: '2026-11-03T02:00:00Z', endedAt: '2026-11-03T02:05:00Z', endReason: 'SESSION_ENDED' });
    report.intervals.push({ ...report.intervals[0]!, id: 'later', sessionId: 'session-2', state: 'UNKNOWN', startedAt: '2026-11-03T02:00:00Z', endedAt: '2026-11-03T02:05:00Z', durationSeconds: 300 });
    render(<StudentDetailView {...baseProps} report={report} />);
    const history = screen.getByTestId('session-history');
    const first = history.querySelector('[data-session-id="session-1"]') as HTMLElement;
    const second = history.querySelector('[data-session-id="session-2"]') as HTMLElement;
    expect(within(first).getAllByTestId('session-activity')).toHaveLength(3);
    expect(within(second).getAllByTestId('session-activity')).toHaveLength(1);
    expect(second).toHaveTextContent('11:00:00 – 11:05:00 · 종료 · 학습 종료');
  });
});
