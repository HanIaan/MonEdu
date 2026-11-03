import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FrameObservation } from '@/features/monitoring/contracts';
import { MonitoringCard, type MonitoringCardProps } from './MonitoringCard';

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
});
