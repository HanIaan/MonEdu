import type { CameraStatus, ModelStatus, TransitionReason } from '@/features/monitoring/contracts';
import {
  CAMERA_STATUS_DETAIL,
  CAMERA_STATUS_LABEL,
  MODEL_STATUS_DETAIL,
  MODEL_STATUS_LABEL,
  cameraNeedsAttention,
  deriveUnavailableReason,
  modelNeedsAttention,
  transitionReasonText,
} from './status';

const CLIENT_REASONS: TransitionReason[] = [
  'CAMERA_STOPPED',
  'CAMERA_PERMISSION_DENIED',
  'INFERENCE_STALLED',
  'MODEL_ERROR',
  'LOW_CONFIDENCE',
  'MONITORING_PAUSED',
  'HEARTBEAT_TIMEOUT',
];

function derive(overrides: Partial<Parameters<typeof deriveUnavailableReason>[0]> = {}) {
  return deriveUnavailableReason({
    engineState: 'UNKNOWN',
    cameraStatus: 'idle',
    modelStatus: 'idle',
    paused: false,
    lastFrameAt: null,
    now: 1_000_000,
    online: true,
    ...overrides,
  });
}

describe('status presentation', () => {
  it('labels every camera and model state distinctly', () => {
    const cameraStates: CameraStatus[] = ['idle', 'requesting', 'active', 'denied', 'unavailable', 'stopped', 'error'];
    const modelStates: ModelStatus[] = ['idle', 'loading', 'ready', 'error'];
    expect(new Set(cameraStates.map((s) => CAMERA_STATUS_LABEL[s])).size).toBe(cameraStates.length);
    expect(new Set(modelStates.map((s) => MODEL_STATUS_LABEL[s])).size).toBe(modelStates.length);
    for (const state of cameraStates) expect(CAMERA_STATUS_DETAIL[state].length).toBeGreaterThan(0);
    for (const state of modelStates) expect(MODEL_STATUS_DETAIL[state].length).toBeGreaterThan(0);
  });

  it('flags the camera and model states that need attention', () => {
    expect(cameraNeedsAttention('denied')).toBe(true);
    expect(cameraNeedsAttention('unavailable')).toBe(true);
    expect(cameraNeedsAttention('stopped')).toBe(true);
    expect(cameraNeedsAttention('error')).toBe(true);
    expect(cameraNeedsAttention('active')).toBe(false);
    expect(cameraNeedsAttention('requesting')).toBe(false);
    expect(modelNeedsAttention('error')).toBe(true);
    expect(modelNeedsAttention('ready')).toBe(false);
  });

  it('maps every client transition reason to a short Korean cause', () => {
    for (const reason of CLIENT_REASONS) {
      const text = transitionReasonText(reason);
      expect(text).toBeTruthy();
      expect(text).toMatch(/[가-힣]/);
    }
    expect(new Set(CLIENT_REASONS.map((r) => transitionReasonText(r))).size).toBe(CLIENT_REASONS.length);
    expect(transitionReasonText(null)).toBeNull();
  });
});

describe('deriveUnavailableReason', () => {
  it('returns null while nothing is wrong', () => {
    expect(derive()).toBeNull();
    expect(derive({ engineState: 'FOCUS_ESTIMATED', cameraStatus: 'active' })).toBeNull();
  });

  it('prioritises paused, then camera permission/stop, model error and offline', () => {
    expect(derive({ paused: true, cameraStatus: 'denied' })).toBe('MONITORING_PAUSED');
    expect(derive({ cameraStatus: 'denied' })).toBe('CAMERA_PERMISSION_DENIED');
    expect(derive({ cameraStatus: 'stopped' })).toBe('CAMERA_STOPPED');
    expect(derive({ cameraStatus: 'unavailable' })).toBe('CAMERA_STOPPED');
    expect(derive({ cameraStatus: 'error' })).toBe('CAMERA_STOPPED');
    expect(derive({ modelStatus: 'error' })).toBe('MODEL_ERROR');
    expect(derive({ online: false })).toBe('HEARTBEAT_TIMEOUT');
  });

  it('distinguishes a stalled frame from low confidence while the camera is active', () => {
    expect(derive({ cameraStatus: 'active', modelStatus: 'ready', lastFrameAt: null })).toBe('INFERENCE_STALLED');
    expect(derive({ cameraStatus: 'active', modelStatus: 'ready', lastFrameAt: 1_000_000 - 6_000 })).toBe(
      'INFERENCE_STALLED',
    );
    expect(derive({ cameraStatus: 'active', modelStatus: 'ready', lastFrameAt: 1_000_000 - 1_000 })).toBe(
      'LOW_CONFIDENCE',
    );
  });
});
