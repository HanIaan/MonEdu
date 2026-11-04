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
  const start = vi.fn(async () => {});
  const resumeMonitoring = vi.fn(async () => {});
  const pauseMonitoring = vi.fn();
  const startBreak = vi.fn();
  const endBreak = vi.fn();
  const end = vi.fn(async () => {});

  const session: StudySessionApi = {
    status: 'idle',
    session: null,
    monitoring: { ...IDLE_MONITORING, ...monitoring },
    sync: { online: true, pendingEvents: 0, lastHeartbeatAt: null, lastError: null },
    cameraStream: null,
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
  it('starts the camera only from the start click (consent is given at sign-up), with no video argument', () => {
    const { session, start } = makeSession();
    renderScreen(session);

    // Nothing starts on render; consent is not asked again here.
    expect(start).not.toHaveBeenCalled();
    expect(screen.getByTestId('privacy-consent')).toBeChecked();
    const startButton = screen.getByTestId('start-session');
    expect(startButton).toBeEnabled();
    fireEvent.click(startButton);

    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]).toEqual([]);
  });

  it('shows the monitoring card with camera, model and analysis-rate status', () => {
    const { session } = makeSession();
    renderScreen(session);
    expect(screen.getByTestId('monitoring-card')).toBeInTheDocument();
    expect(screen.getByTestId('camera-status')).toHaveAttribute('data-status', 'idle');
    expect(screen.getByTestId('camera-status')).toHaveTextContent('대기 중');
    expect(screen.getByTestId('model-status')).toHaveAttribute('data-status', 'idle');
    expect(screen.getByTestId('analysis-fps')).toHaveAttribute('data-fps', '0.0');
    expect(screen.getByTestId('current-state')).toHaveAttribute('data-state', 'FOCUS_ESTIMATED');
    expect(screen.getByTestId('sync-status')).toHaveAttribute('data-pending', '0');
  });

  it('shows the day timeline from the report', () => {
    const { session } = makeSession();
    renderScreen(session);
    expect(screen.getByTestId('timeline')).toBeInTheDocument();
    expect(screen.getAllByTestId('timeline-segment')).toHaveLength(3);
  });

  it('toggles the preview without mounting it by default and without calling session methods', () => {
    const { session, start, pauseMonitoring, resumeMonitoring, startBreak, endBreak, end } = makeSession();
    renderScreen(session);

    expect(screen.queryByTestId('camera-preview')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('preview-toggle'));
    expect(screen.getByTestId('camera-preview')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('preview-toggle'));
    expect(screen.queryByTestId('camera-preview')).not.toBeInTheDocument();

    expect(start).not.toHaveBeenCalled();
    expect(pauseMonitoring).not.toHaveBeenCalled();
    expect(resumeMonitoring).not.toHaveBeenCalled();
    expect(startBreak).not.toHaveBeenCalled();
    expect(endBreak).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });

  it('drives break, pause and end through the session API', () => {
    const { session, startBreak, endBreak, pauseMonitoring, resumeMonitoring, end } = makeSession(
      { status: 'active' },
      { cameraStatus: 'active', modelStatus: 'ready', engineState: 'FOCUS_ESTIMATED' },
    );
    renderScreen(session);

    // A break also turns the camera off, after the break is declared.
    fireEvent.click(screen.getByTestId('break-start'));
    expect(startBreak).toHaveBeenCalledTimes(1);
    expect(pauseMonitoring).toHaveBeenCalledTimes(1);
    expect(startBreak.mock.invocationCallOrder[0]).toBeLessThan(pauseMonitoring.mock.invocationCallOrder[0]!);

    fireEvent.click(screen.getByTestId('pause-monitoring'));
    expect(pauseMonitoring).toHaveBeenCalledTimes(2);
    expect(endBreak).not.toHaveBeenCalled();
    expect(resumeMonitoring).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('end-session'));
    expect(end).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('confirm-end'));
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('ends a break by turning the camera back on', () => {
    const { session, endBreak, resumeMonitoring } = makeSession(
      { status: 'active' },
      { cameraStatus: 'stopped', modelStatus: 'idle', engineState: 'BREAK', onBreak: true, paused: true },
    );
    renderScreen(session);

    fireEvent.click(screen.getByTestId('break-end'));
    expect(endBreak).toHaveBeenCalledTimes(1);
    expect(resumeMonitoring).toHaveBeenCalledTimes(1);
    expect(endBreak.mock.invocationCallOrder[0]).toBeLessThan(resumeMonitoring.mock.invocationCallOrder[0]!);
    // No resume button competes with "다시 공부하기" during a break.
    expect(screen.queryByTestId('resume-monitoring')).not.toBeInTheDocument();
  });

  it('resumes monitoring with no video argument', () => {
    const { session, resumeMonitoring } = makeSession(
      { status: 'active' },
      { cameraStatus: 'stopped', modelStatus: 'ready', engineState: 'UNKNOWN', paused: true },
    );
    renderScreen(session);

    fireEvent.click(screen.getByTestId('resume-monitoring'));
    expect(resumeMonitoring).toHaveBeenCalledTimes(1);
    expect(resumeMonitoring.mock.calls[0]).toEqual([]);
  });
});
