import { render, screen } from '@testing-library/react';
import type { SyncStatus } from '@/features/monitoring/contracts';
import { LiveStats, deriveLiveValues, type LiveValues } from './LiveStats';
import { makeReport } from '@/features/dashboard/testFixtures';

const SYNC: SyncStatus = { online: true, pendingEvents: 0, lastHeartbeatAt: null, lastError: null };

function makeValues(overrides: Partial<LiveValues> = {}): LiveValues {
  return {
    referenceTime: '2026-11-03T00:00:00Z',
    firstSeatedAt: '2026-11-03T00:13:22Z',
    lateSeconds: 802,
    lateStatus: 'LATE',
    currentState: 'FOCUS_ESTIMATED',
    currentStateSince: '2026-11-03T00:35:00Z',
    hasActiveSession: true,
    focusSeconds: 802,
    currentStreakSeconds: 802,
    longestStreakSeconds: 1200,
    awaySeconds: 60,
    distractionSeconds: 120,
    unknownSeconds: 30,
    breakSeconds: 0,
    ...overrides,
  };
}

describe('LiveStats', () => {
  it('formats 802 seconds as "13분 22초" and exposes raw seconds for E2E', () => {
    render(<LiveStats values={makeValues()} sync={SYNC} />);
    expect(screen.getByTestId('focus-total')).toHaveTextContent('13분 22초');
    expect(screen.getByTestId('focus-total')).toHaveAttribute('data-seconds', '802');
    expect(screen.getByTestId('current-streak')).toHaveAttribute('data-seconds', '802');
    expect(screen.getByTestId('longest-streak')).toHaveAttribute('data-seconds', '1200');
    expect(screen.getByTestId('away-total')).toHaveAttribute('data-seconds', '60');
    expect(screen.getByTestId('distraction-total')).toHaveAttribute('data-seconds', '120');
    expect(screen.getByTestId('unknown-total')).toHaveAttribute('data-seconds', '30');
    expect(screen.getByTestId('late-seconds')).toHaveTextContent('13분 22초');
    expect(screen.getByTestId('late-seconds')).toHaveAttribute('data-seconds', '802');
  });

  it('renders an empty data-seconds when the student has not been seated', () => {
    render(
      <LiveStats
        values={makeValues({ lateSeconds: null, lateStatus: 'NOT_SEATED', firstSeatedAt: null })}
        sync={SYNC}
      />,
    );
    expect(screen.getByTestId('late-seconds')).toHaveAttribute('data-seconds', '');
    expect(screen.getByTestId('late-seconds')).toHaveTextContent('미착석');
    expect(screen.getByTestId('first-seated-at')).toHaveTextContent('아직 없음');
  });

  it('exposes the current state and sync status', () => {
    render(<LiveStats values={makeValues({ currentState: 'DISTRACTION_SUSPECTED' })} sync={{ ...SYNC, pendingEvents: 3 }} />);
    expect(screen.getByTestId('current-state')).toHaveAttribute('data-state', 'DISTRACTION_SUSPECTED');
    expect(screen.getByTestId('current-state')).toHaveTextContent('비집중 의심');
    expect(screen.getByTestId('sync-status')).toHaveAttribute('data-pending', '3');
    expect(screen.getByTestId('sync-status')).toHaveTextContent('동기화 대기 3건');
  });
});

describe('deriveLiveValues', () => {
  it('ticks the open focus interval from elapsed wall time, not tick counts', () => {
    const report = makeReport();
    const fetchedAt = 1_000_000;
    const values = deriveLiveValues(report, fetchedAt, fetchedAt + 45_000);
    expect(values.focusSeconds).toBe(report.totals.focusSeconds + 45);
    expect(values.currentStreakSeconds).toBe(report.currentStreakSeconds + 45);
    // longest streak can never be shorter than the live current streak
    expect(values.longestStreakSeconds).toBeGreaterThanOrEqual(values.currentStreakSeconds);
  });

  it('does not tick states that are not open', () => {
    const report = makeReport({ intervals: [], currentState: null, activeSessionId: null });
    const values = deriveLiveValues(report, 1_000_000, 1_060_000);
    expect(values.focusSeconds).toBe(report.totals.focusSeconds);
    expect(values.hasActiveSession).toBe(false);
    expect(values.currentState).toBe('UNKNOWN');
  });
});
