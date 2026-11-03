import { fireEvent, render, screen } from '@testing-library/react';
import type { MonitoringSnapshot, StudySessionApi } from '@/features/monitoring/contracts';
import { makeReport } from '@/features/dashboard/testFixtures';
import { StudentStudyScreen } from './StudentStudyScreen';

const IDLE_MONITORING: MonitoringSnapshot = {
  cameraStatus: 'idle',
  modelStatus: 'idle',
  engineState: 'UNKNOWN',
  stateSince: 0,
  lastFrameAt: null,
  lastObservation: null,
  pageVisible: true,
  inferenceBackend: null,
  onBreak: false,
  paused: false,
  perf: { framesProcessed: 0, framesSkipped: 0, avgInferenceMs: 0, jsHeapBytes: null },
  error: null,
};

function makeSession(overrides: Partial<StudySessionApi> = {}, monitoring: Partial<MonitoringSnapshot> = {}) {
  const start = vi.fn(async (...args: [HTMLVideoElement]) => {
    void args;
  });
  const resumeMonitoring = vi.fn(async (...args: [HTMLVideoElement]) => {
    void args;
  });
  const pauseMonitoring = vi.fn();
  const startBreak = vi.fn();
  const endBreak = vi.fn();
  const end = vi.fn(async () => {});

  const session: StudySessionApi = {
    status: 'idle',
    session: null,
    monitoring: { ...IDLE_MONITORING, ...monitoring },
    sync: { online: true, pendingEvents: 0, lastHeartbeatAt: null, lastError: null },
    start,
    pauseMonitoring,
    resumeMonitoring,
    startBreak,
    endBreak,
    end,
    ...overrides,
  };
  return { session, start, resumeMonitoring, pauseMonitoring, startBreak, endBreak, end };
}

function renderScreen(session: StudySessionApi) {
  const onRefreshReport = vi.fn();
  render(
    <StudentStudyScreen
      session={session}
      report={makeReport()}
      reportLoading={false}
      reportError={null}
      fetchedAt={Date.now()}
      onRefreshReport={onRefreshReport}
      tickMs={0}
    />,
  );
  return { onRefreshReport };
}

describe('StudentStudyScreen', () => {
  it('requires privacy consent before starting, then calls start(videoEl)', () => {
    const { session, start } = makeSession();
    renderScreen(session);

    const startButton = screen.getByTestId('start-session');
    expect(startButton).toBeDisabled();
    fireEvent.click(startButton);
    expect(start).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('privacy-consent'));
    expect(startButton).toBeEnabled();
    fireEvent.click(startButton);

    expect(start).toHaveBeenCalledTimes(1);
    const video = start.mock.calls[0]![0];
    expect(video).toBeInstanceOf(HTMLVideoElement);
  });

  it('always shows camera and model status with data-status', () => {
    const { session } = makeSession();
    renderScreen(session);
    expect(screen.getByTestId('camera-status')).toHaveAttribute('data-status', 'idle');
    expect(screen.getByTestId('camera-status')).toHaveTextContent('대기 중');
    expect(screen.getByTestId('model-status')).toHaveAttribute('data-status', 'idle');
    expect(screen.getByTestId('current-state')).toHaveAttribute('data-state', 'FOCUS_ESTIMATED');
    expect(screen.getByTestId('sync-status')).toHaveAttribute('data-pending', '0');
  });

  it('drives break, pause and end through the session API', () => {
    const { session, startBreak, pauseMonitoring, end } = makeSession(
      { status: 'active' },
      { cameraStatus: 'active', modelStatus: 'ready', engineState: 'FOCUS_ESTIMATED' },
    );
    renderScreen(session);

    fireEvent.click(screen.getByTestId('break-start'));
    expect(startBreak).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('pause-monitoring'));
    expect(pauseMonitoring).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('end-session'));
    expect(end).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('confirm-end'));
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('resumes monitoring through the API', () => {
    const { session, resumeMonitoring } = makeSession(
      { status: 'active' },
      { cameraStatus: 'stopped', modelStatus: 'ready', engineState: 'UNKNOWN', paused: true },
    );
    renderScreen(session);

    fireEvent.click(screen.getByTestId('resume-monitoring'));
    expect(resumeMonitoring).toHaveBeenCalledTimes(1);
    expect(resumeMonitoring.mock.calls[0]![0]).toBeInstanceOf(HTMLVideoElement);
  });
});
