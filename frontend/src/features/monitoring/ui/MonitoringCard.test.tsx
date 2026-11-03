import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FrameObservation, MonitoringPerf } from '@/features/monitoring/contracts';
import { MonitoringCard, type MonitoringCardProps } from './MonitoringCard';

const PERF: MonitoringPerf = {
  framesProcessed: 0,
  framesSkipped: 0,
  avgInferenceMs: 8,
  jsHeapBytes: null,
};

const OBSERVATION: FrameObservation = {
  at: Date.now(),
  frameQuality: 'OK',
  faceDetected: true,
  faceScore: 0.92,
  upperBodyDetected: false,
  poseScore: 0.1,
  phoneEvaluated: false,
  phoneDetected: false,
  phoneScore: 0,
  inferenceMs: 12,
};

function makeProps(overrides: Partial<MonitoringCardProps> = {}): MonitoringCardProps {
  return {
    cameraStatus: 'idle',
    modelStatus: 'idle',
    engineState: 'UNKNOWN',
    lastObservation: null,
    framesProcessed: 0,
    paused: false,
    sessionStatus: 'idle',
    cameraStream: null,
    cameraError: null,
    onPause: vi.fn(),
    onResume: vi.fn(),
    ...overrides,
  };
}

describe('MonitoringCard', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('auto-opens the first-time framing check with live observation checks', async () => {
    const { rerender } = render(<MonitoringCard {...makeProps()} />);
    expect(screen.queryByTestId('camera-preview')).not.toBeInTheDocument();

    rerender(<MonitoringCard {...makeProps({ cameraStatus: 'active', lastObservation: OBSERVATION })} />);

    await waitFor(() => expect(screen.getByTestId('camera-preview')).toBeInTheDocument());
    expect(screen.getByText('얼굴과 어깨가 화면 안에 들어오게 앉아 주세요.')).toBeInTheDocument();
    expect(screen.getByTestId('framing-face')).toHaveAttribute('data-ok', 'true');
    expect(screen.getByTestId('framing-body')).toHaveAttribute('data-ok', 'false');
    expect(screen.getByTestId('camera-status')).toHaveAttribute('data-status', 'active');
    expect(screen.getByTestId('model-status')).toHaveAttribute('data-status', 'idle');
    expect(screen.getByTestId('analysis-fps')).toHaveAttribute('data-fps');
    expect(screen.getByText('카메라 작동 중')).toBeInTheDocument();
  });

  it('closes the preview when the framing is confirmed and remembers completion', async () => {
    render(<MonitoringCard {...makeProps({ cameraStatus: 'active', lastObservation: OBSERVATION })} />);
    await waitFor(() => expect(screen.getByTestId('camera-preview')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('framing-done'));

    expect(screen.queryByTestId('camera-preview')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('sm.framingDone')).toBe('1');
  });

  it('does not auto-open once completion is remembered', () => {
    window.localStorage.setItem('sm.framingDone', '1');
    render(<MonitoringCard {...makeProps({ cameraStatus: 'active', lastObservation: OBSERVATION })} />);
    expect(screen.queryByTestId('camera-preview')).not.toBeInTheDocument();
  });

  it('toggles the preview manually and unmounts it when closed', () => {
    render(<MonitoringCard {...makeProps()} />);
    const toggle = screen.getByTestId('preview-toggle');
    expect(toggle).toHaveTextContent('미리보기 확인');

    fireEvent.click(toggle);
    expect(screen.getByTestId('camera-preview')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(toggle);
    expect(screen.queryByTestId('camera-preview')).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows the camera denial cause and retries through resumeMonitoring (onResume)', () => {
    const onResume = vi.fn();
    render(
      <MonitoringCard
        {...makeProps({ sessionStatus: 'active', cameraStatus: 'denied', engineState: 'UNKNOWN', onResume })}
      />,
    );

    expect(screen.getByTestId('camera-status-cause')).toHaveAttribute('data-status', 'denied');
    expect(screen.getByTestId('camera-status-cause')).toHaveTextContent('권한이 거부');
    expect(screen.getByTestId('unknown-state')).toHaveAttribute('data-reason', 'CAMERA_PERMISSION_DENIED');

    fireEvent.click(screen.getByTestId('monitoring-retry'));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('shows a distinct model error cause with a retry action', () => {
    const onResume = vi.fn();
    render(
      <MonitoringCard
        {...makeProps({ sessionStatus: 'active', modelStatus: 'error', engineState: 'UNKNOWN', onResume })}
      />,
    );

    expect(screen.getByTestId('model-status-cause')).toHaveAttribute('data-status', 'error');
    expect(screen.getByTestId('model-status-cause')).toHaveTextContent('불러오지 못했습니다');
    expect(screen.getByTestId('unknown-state')).toHaveAttribute('data-reason', 'MODEL_ERROR');
    expect(screen.getByTestId('monitoring-retry')).toBeInTheDocument();
  });

  it('explains a paused monitoring state', () => {
    render(
      <MonitoringCard
        {...makeProps({
          sessionStatus: 'active',
          cameraStatus: 'stopped',
          modelStatus: 'ready',
          engineState: 'UNKNOWN',
          paused: true,
        })}
      />,
    );

    expect(screen.getByTestId('unknown-state')).toHaveAttribute('data-reason', 'MONITORING_PAUSED');
    expect(screen.getByTestId('unknown-state-reason')).toHaveTextContent('일시 중단');
    // The existing pause/resume controls handle the paused case; no duplicate retry button.
    expect(screen.queryByTestId('monitoring-retry')).not.toBeInTheDocument();
  });

  it('reports a stalled analysis as the cause of an unknown state', () => {
    render(
      <MonitoringCard
        {...makeProps({
          sessionStatus: 'active',
          cameraStatus: 'active',
          modelStatus: 'ready',
          engineState: 'UNKNOWN',
          lastFrameAt: 10_000,
          now: 20_000,
        })}
      />,
    );

    expect(screen.getByTestId('unknown-state')).toHaveAttribute('data-reason', 'INFERENCE_STALLED');
    expect(screen.getByTestId('unknown-state-reason')).toHaveTextContent('분석이 지연');
  });

  it('does not offer a retry before a session is active', () => {
    render(<MonitoringCard {...makeProps({ cameraStatus: 'denied', sessionStatus: 'idle' })} />);
    expect(screen.queryByTestId('monitoring-retry')).not.toBeInTheDocument();
  });

  it('shows the low-power notice with the effective interval and explanation', () => {
    render(
      <MonitoringCard
        {...makeProps({ perf: { ...PERF, lowPower: true, effectiveIntervalMs: 2_000 } })}
      />,
    );

    const notice = screen.getByTestId('low-power-notice');
    expect(notice).toHaveTextContent('저사양 모드: 감지 간격 2초');
    expect(notice).toHaveAttribute('data-interval-ms', '2000');
    // The tooltip explains the accuracy trade-off and that time accounting is unchanged.
    expect(notice).toHaveTextContent('상태 변화가 최대 2초 늦게 반영될 수 있지만');
    expect(notice).toHaveTextContent('학습 시간 계산은 동일합니다');
  });

  it('formats a fractional detection interval', () => {
    render(
      <MonitoringCard
        {...makeProps({ perf: { ...PERF, lowPower: true, effectiveIntervalMs: 1_500 } })}
      />,
    );
    expect(screen.getByTestId('low-power-notice')).toHaveTextContent('감지 간격 1.5초');
  });

  it('still explains low-power mode when the interval is not reported yet', () => {
    render(<MonitoringCard {...makeProps({ perf: { ...PERF, lowPower: true } })} />);
    expect(screen.getByTestId('low-power-notice')).toHaveTextContent('감지 간격 조정됨');
  });

  it('hides the low-power notice when the engine is not in low-power mode', () => {
    render(<MonitoringCard {...makeProps({ perf: PERF })} />);
    expect(screen.queryByTestId('low-power-notice')).not.toBeInTheDocument();
  });

  it('shows p95 inference time only when reported', () => {
    const { rerender } = render(<MonitoringCard {...makeProps({ perf: PERF })} />);
    expect(screen.queryByTestId('p95-inference')).not.toBeInTheDocument();

    rerender(<MonitoringCard {...makeProps({ perf: { ...PERF, p95InferenceMs: 42.6 } })} />);
    expect(screen.getByTestId('p95-inference')).toHaveTextContent('43 ms');
  });
});
