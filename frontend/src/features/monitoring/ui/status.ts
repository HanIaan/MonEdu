import type {
  ActivityState,
  CameraStatus,
  ModelStatus,
  TransitionReason,
} from '@/features/monitoring/contracts';

export const CAMERA_STATUS_LABEL: Record<CameraStatus, string> = {
  idle: '대기 중',
  requesting: '권한 요청 중',
  active: '작동 중',
  denied: '권한 거부',
  unavailable: '장치 없음',
  stopped: '중단됨',
  error: '오류',
};

export const MODEL_STATUS_LABEL: Record<ModelStatus, string> = {
  idle: '대기 중',
  loading: '불러오는 중',
  ready: '준비됨',
  error: '오류',
};

export function cameraStatusTone(status: CameraStatus): 'ok' | 'warn' | 'bad' | 'idle' {
  if (status === 'active') return 'ok';
  if (status === 'requesting') return 'warn';
  if (status === 'denied' || status === 'unavailable' || status === 'error') return 'bad';
  return 'idle';
}

export function modelStatusTone(status: ModelStatus): 'ok' | 'warn' | 'bad' | 'idle' {
  if (status === 'ready') return 'ok';
  if (status === 'loading') return 'warn';
  if (status === 'error') return 'bad';
  return 'idle';
}

/** Human-readable cause/next step for each camera state (shown under the status row). */
export const CAMERA_STATUS_DETAIL: Record<CameraStatus, string> = {
  idle: '카메라가 꺼져 있습니다.',
  requesting: '브라우저에서 카메라 권한을 확인하는 중입니다.',
  active: '카메라가 켜져 있고 영상은 브라우저 안에서만 분석됩니다.',
  denied: '카메라 권한이 거부되었습니다. 주소창의 카메라 아이콘에서 허용한 뒤 다시 시도해 주세요.',
  unavailable: '사용 가능한 카메라를 찾지 못했습니다. 카메라 연결을 확인한 뒤 다시 시도해 주세요.',
  stopped: '카메라가 중단되었습니다. ‘모니터링 재개’를 누르면 다시 켜집니다.',
  error: '카메라를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.',
};

export const MODEL_STATUS_DETAIL: Record<ModelStatus, string> = {
  idle: 'AI 모델이 아직 로드되지 않았습니다.',
  loading: 'AI 모델을 불러오는 중입니다.',
  ready: 'AI 모델이 준비되었습니다.',
  error: 'AI 모델을 불러오지 못했습니다. 다시 시도해 주세요.',
};

/** True when the camera state needs the student's attention (and a retry may help). */
export function cameraNeedsAttention(status: CameraStatus): boolean {
  return status === 'denied' || status === 'unavailable' || status === 'stopped' || status === 'error';
}

export function modelNeedsAttention(status: ModelStatus): boolean {
  return status === 'error';
}

/**
 * Short Korean cause for a transition reason (contract `TransitionReason`).
 * The client-side reasons are the ones the UI can explain; server-only reasons get a generic line.
 */
const TRANSITION_REASON_TEXT: Record<string, string> = {
  CAMERA_STOPPED: '카메라가 꺼져 있어 측정할 수 없습니다.',
  CAMERA_PERMISSION_DENIED: '카메라 권한이 거부되어 측정할 수 없습니다.',
  INFERENCE_STALLED: '분석이 지연되어 측정할 수 없습니다.',
  MODEL_ERROR: 'AI 모델 오류로 측정할 수 없습니다.',
  LOW_CONFIDENCE: '화면이 흐리거나 어두워 상태를 판단하기 어렵습니다.',
  MONITORING_PAUSED: '모니터링이 일시 중단되어 측정하지 않습니다.',
  HEARTBEAT_TIMEOUT: '서버 연결이 끊겨 측정할 수 없습니다.',
};

export function transitionReasonText(reason: TransitionReason | null | undefined): string | null {
  if (!reason) return null;
  return TRANSITION_REASON_TEXT[reason] ?? '측정할 수 없는 상태입니다.';
}

export interface UnavailableInput {
  engineState: ActivityState;
  cameraStatus: CameraStatus;
  modelStatus: ModelStatus;
  paused: boolean;
  lastFrameAt: number | null;
  /** Epoch ms "now"; injected so the derivation is deterministic in tests. */
  now: number;
  /** No processed frame for longer than this means inference stalled (default 5 s). */
  staleFrameMs?: number;
  /** Client network state; false hints at a heartbeat timeout on the server. */
  online?: boolean;
}

/**
 * Best-effort client-side reason for an UNKNOWN / "측정 불가" state.
 * The snapshot does not carry the last TransitionReason, so it is derived from the observable
 * status fields in priority order. Returns null when nothing is wrong (e.g. not started yet).
 */
export function deriveUnavailableReason(input: UnavailableInput): TransitionReason | null {
  const { engineState, cameraStatus, modelStatus, paused, lastFrameAt, now } = input;
  const staleFrameMs = input.staleFrameMs ?? 5_000;

  if (paused) return 'MONITORING_PAUSED';
  if (cameraStatus === 'denied') return 'CAMERA_PERMISSION_DENIED';
  if (cameraStatus === 'stopped') return 'CAMERA_STOPPED';
  if (cameraStatus === 'unavailable' || cameraStatus === 'error') return 'CAMERA_STOPPED';
  if (modelStatus === 'error') return 'MODEL_ERROR';
  if (input.online === false) return 'HEARTBEAT_TIMEOUT';

  if (engineState === 'UNKNOWN' && cameraStatus === 'active') {
    const stale = lastFrameAt === null || now - lastFrameAt > staleFrameMs;
    return stale ? 'INFERENCE_STALLED' : 'LOW_CONFIDENCE';
  }

  return null;
}

export const TONE_DOT: Record<'ok' | 'warn' | 'bad' | 'idle', string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-rose-500',
  idle: 'bg-slate-400',
};

export const TONE_TEXT: Record<'ok' | 'warn' | 'bad' | 'idle', string> = {
  ok: 'text-emerald-700',
  warn: 'text-amber-700',
  bad: 'text-rose-700',
  idle: 'text-slate-600',
};

export function errorText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return '알 수 없는 오류가 발생했습니다.';
}
