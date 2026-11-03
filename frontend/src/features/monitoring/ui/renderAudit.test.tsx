import { render } from '@testing-library/react';
import type { MonitoringSnapshot, SessionStatus, StudySessionApi } from '@/features/monitoring/contracts';
import { makeReport } from '@/features/dashboard/testFixtures';
import { StudentStudyScreen } from './StudentStudyScreen';

/**
 * Render-audit (P2-W3 step 1): the 4 Hz monitoring snapshot must not re-render the
 * timeline, the live stats or the session controls. Counters are installed by wrapping the
 * imported components; the memo boundaries live in the screen, so the wrappers still get
 * skipped when their props are referentially unchanged.
 */
const counters = vi.hoisted(() => ({ timeline: 0, liveStats: 0, sessionControls: 0 }));

vi.mock('@/components/Timeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/Timeline')>();
  const React = await import('react');
  return {
    ...actual,
    Timeline: (props: Parameters<typeof actual.Timeline>[0]) => {
      counters.timeline += 1;
      return React.createElement(actual.Timeline, props);
    },
  };
});

vi.mock('./LiveStats', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./LiveStats')>();
  const React = await import('react');
  return {
    ...actual,
    LiveStats: (props: Parameters<typeof actual.LiveStats>[0]) => {
      counters.liveStats += 1;
      return React.createElement(actual.LiveStats, props);
    },
  };
});

vi.mock('./SessionControls', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./SessionControls')>();
  const React = await import('react');
  return {
    ...actual,
    SessionControls: (props: Parameters<typeof actual.SessionControls>[0]) => {
      counters.sessionControls += 1;
      return React.createElement(actual.SessionControls, props);
    },
  };
});

const IDLE_MONITORING: MonitoringSnapshot = {
  cameraStatus: 'active',
  modelStatus: 'ready',
  engineState: 'FOCUS_ESTIMATED',
  stateSince: 0,
  lastFrameAt: null,
  lastObservation: null,
  pageVisible: true,
  inferenceBackend: 'WORKER',
  onBreak: false,
  paused: false,
  perf: { framesProcessed: 120, framesSkipped: 0, avgInferenceMs: 8, jsHeapBytes: null },
  error: null,
};

const SYNC = { online: true, pendingEvents: 0, lastHeartbeatAt: null, lastError: null };

/** Shared report/session identity: the real app keeps both stable across snapshot ticks. */
const REPORT = makeReport();

function makeSession(framesProcessed: number): StudySessionApi {
  return {
    status: 'active' as SessionStatus,
    session: null,
    monitoring: {
      ...IDLE_MONITORING,
      perf: { ...IDLE_MONITORING.perf, framesProcessed },
    },
    sync: SYNC,
    cameraStream: null,
    start: vi.fn(async () => {}),
    pauseMonitoring: vi.fn(),
    resumeMonitoring: vi.fn(async () => {}),
    startBreak: vi.fn(),
    endBreak: vi.fn(),
    end: vi.fn(async () => {}),
  };
}

const BASE_SESSION = makeSession(120);

/** Only the monitoring snapshot changes; every other prop keeps its identity. */
function tickedSession(framesProcessed: number): StudySessionApi {
  return {
    ...BASE_SESSION,
    monitoring: { ...BASE_SESSION.monitoring, perf: { ...BASE_SESSION.monitoring.perf, framesProcessed } },
  };
}

function renderScreen(session: StudySessionApi) {
  return (
    <StudentStudyScreen
      session={session}
      report={REPORT}
      reportLoading={false}
      reportError={null}
      fetchedAt={1_000_000}
      onRefreshReport={vi.fn()}
      tickMs={0}
    />
  );
}

describe('StudentStudyScreen render audit (4 Hz monitoring snapshot)', () => {
  beforeEach(() => {
    counters.timeline = 0;
    counters.liveStats = 0;
    counters.sessionControls = 0;
  });

  it('re-renders only the monitoring card for snapshot ticks', () => {
    const { rerender } = render(renderScreen(BASE_SESSION));

    // Initial mount renders each child once.
    expect(counters.timeline).toBe(1);
    expect(counters.liveStats).toBe(1);
    expect(counters.sessionControls).toBe(1);

    // Simulate four 4 Hz snapshot ticks (new monitoring object, same data except a counter).
    for (let tick = 1; tick <= 4; tick += 1) {
      rerender(renderScreen(tickedSession(120 + tick)));
    }

    // Memoised children must not have re-rendered for the monitoring snapshot changes.
    expect(counters.timeline).toBe(1);
    expect(counters.liveStats).toBe(1);
    expect(counters.sessionControls).toBe(1);
  });

  it('re-renders the live stats when the report changes (not only the snapshot)', () => {
    const { rerender } = render(renderScreen(BASE_SESSION));
    expect(counters.liveStats).toBe(1);

    const nextReport = makeReport({ totals: { focusSeconds: 30_000, distractionSeconds: 0, awaySeconds: 0, unknownSeconds: 0, breakSeconds: 0 } });
    rerender(
      <StudentStudyScreen
        session={tickedSession(121)}
        report={nextReport}
        reportLoading={false}
        reportError={null}
        fetchedAt={1_000_000}
        onRefreshReport={vi.fn()}
        tickMs={0}
      />,
    );

    expect(counters.liveStats).toBe(2);
  });
});
