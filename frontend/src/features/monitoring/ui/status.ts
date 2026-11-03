import type { CameraStatus, ModelStatus } from '@/features/monitoring/contracts';

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
