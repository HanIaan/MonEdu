import { render, screen, within } from '@testing-library/react';
import { makeReport } from '@/features/dashboard/testFixtures';
import { STUDENT_STATE_LABEL } from './StateBadge';
import { Timeline } from './Timeline';

function renderTimeline() {
  const report = makeReport();
  render(<Timeline intervals={report.intervals} computedAt={report.computedAt} />);
  return report;
}

describe('Timeline', () => {
  it('renders one segment per interval in chronological order', () => {
    const report = renderTimeline();
    const segments = screen.getAllByTestId('timeline-segment');
    expect(segments).toHaveLength(report.intervals.length);
    expect(segments.map((segment) => segment.getAttribute('data-state'))).toEqual([
      'FOCUS_ESTIMATED',
      'AWAY',
      'FOCUS_ESTIMATED',
    ]);
  });

  it('marks the open interval and sizes segments over the day span', () => {
    renderTimeline();
    const segments = screen.getAllByTestId('timeline-segment');
    expect(segments[0]).toHaveAttribute('data-open', 'false');
    expect(segments[2]).toHaveAttribute('data-open', 'true');

    // Span 00:00Z–01:00Z (= 3600 s): 1800 s, 300 s, 1500 s.
    expect(segments[0]!.parentElement?.style.width).toBe('50%');
    expect(segments[2]!.parentElement?.style.width).toBe(`${(1500 / 3600) * 100}%`);
    expect(segments[2]).toHaveAttribute('aria-label', expect.stringContaining('진행 중'));
  });

  it('provides an accessible table fallback listing every interval', () => {
    const report = renderTimeline();
    const table = screen.getByRole('table', { hidden: true });
    const rows = within(table).getAllByRole('row', { hidden: true });
    // header + one row per interval
    expect(rows).toHaveLength(report.intervals.length + 1);
    expect(within(table).getByText('09:00:00')).toBeInTheDocument();
    expect(within(table).getByText('10:00:00 (진행 중)')).toBeInTheDocument();
  });

  it('shows an empty message when there are no intervals', () => {
    render(<Timeline intervals={[]} computedAt="2026-11-03T01:00:00Z" />);
    expect(screen.getByTestId('timeline')).toHaveTextContent('활동 구간이 없습니다');
  });

  it('labels the axis as Asia/Seoul (KST)', () => {
    renderTimeline();
    expect(screen.getByText('Asia/Seoul (KST)')).toBeInTheDocument();
    expect(screen.getAllByText('09:00:00').length).toBeGreaterThan(0);
  });

  it('renders a labelled legend so colour is never the only signal', () => {
    renderTimeline();
    const legend = screen.getByTestId('timeline-legend');
    expect(legend).toHaveTextContent('범례');
    for (const label of ['집중 추정', '비집중 의심', '자리비움', '측정 불가', '휴식']) {
      expect(within(legend).getByText(label)).toBeInTheDocument();
    }
  });

  it('includes the transition reason in the segment tooltip', () => {
    renderTimeline();
    const segments = screen.getAllByTestId('timeline-segment');
    expect(segments[0]).toHaveAttribute('aria-label', expect.stringContaining('착석 확인'));
  });

  it('fills unrecorded time between intervals as not-measured when asked', () => {
    const report = makeReport();
    // First interval ends 10 minutes earlier: 00:20–00:30 has no record.
    const gapped = report.intervals.map((interval, index) =>
      index === 0 ? { ...interval, endedAt: '2026-11-03T00:20:00Z', durationSeconds: 1200 } : interval,
    );
    render(<Timeline intervals={gapped} computedAt={report.computedAt} labels={{ ...STUDENT_STATE_LABEL }} fillGaps />);
    const gaps = screen.getAllByTestId('timeline-gap');
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toHaveAttribute('aria-label', expect.stringContaining('미측정 (기록 없음)'));
    expect(gaps[0]).toHaveAttribute('aria-label', expect.stringContaining('10분 0초'));
    expect(gaps[0]!.parentElement?.style.width).toBe(`${(600 / 3600) * 100}%`);
    // Recorded intervals are unchanged.
    expect(screen.getAllByTestId('timeline-segment')).toHaveLength(3);
  });

  it('keeps gaps empty by default', () => {
    const report = makeReport();
    render(<Timeline intervals={report.intervals} computedAt={report.computedAt} />);
    expect(screen.queryByTestId('timeline-gap')).not.toBeInTheDocument();
  });

  it('does not paint unverified time as focus before a late timeout report arrives', () => {
    const report = makeReport();
    const stalled = report.intervals.map((interval) => interval.open ? { ...interval, durationSeconds: 60 } : interval);
    const { rerender } = render(<Timeline intervals={stalled} computedAt={report.computedAt} />);
    const focus = screen.getAllByTestId('timeline-segment').at(-1)!;
    expect(focus.parentElement?.style.width).toBe(`${(60 / 3600) * 100}%`);
    expect(focus).toHaveAttribute('aria-label', expect.stringContaining('09:35:00–09:36:00'));
    expect(screen.getByTestId('timeline-pending')).toHaveAttribute('aria-label', expect.stringContaining('09:36:00–10:00:00'));

    // The server later confirms UNKNOWN from the last verified instant. The previous focus
    // segment must keep the same width: only the previously pending tail changes state.
    const confirmed = stalled.map((interval) => interval.open
      ? { ...interval, endedAt: '2026-11-03T00:36:00Z', open: false } : interval);
    confirmed.push({ ...stalled.at(-1)!, id: 'timeout', state: 'UNKNOWN', reason: 'HEARTBEAT_TIMEOUT',
      startedAt: '2026-11-03T00:36:00Z', endedAt: null, open: true, durationSeconds: 1440 });
    rerender(<Timeline intervals={confirmed} computedAt={report.computedAt} />);
    expect(screen.getAllByTestId('timeline-segment')[2]!.parentElement?.style.width).toBe(`${(60 / 3600) * 100}%`);
    expect(screen.queryByTestId('timeline-pending')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('timeline-segment').at(-1)).toHaveAttribute('data-state', 'UNKNOWN');
  });
});
