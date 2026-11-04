'use client';
import { useState } from 'react';
import type { SessionStatus } from '@/features/monitoring/contracts';

export interface SessionControlsProps {
  status: SessionStatus;
  /** True while the student-declared break is active (primitive keeps this component memo-safe). */
  onBreak: boolean;
  onStart: () => void;
  onBreakStart: () => void;
  onBreakEnd: () => void;
  onEnd: () => void;
  busy?: boolean;
  error?: string | null;
}

const BASE =
  'inline-flex h-16 items-center justify-center gap-2 rounded-full px-10 text-lg font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY = `${BASE} bg-slate-900 text-white hover:bg-slate-700 focus-visible:outline-slate-900`;
const SECONDARY = `${BASE} bg-slate-100 text-slate-900 hover:bg-slate-200 focus-visible:outline-slate-900`;
const QUIET = `${BASE} px-6 text-base text-slate-500 hover:text-rose-700 focus-visible:outline-rose-700`;

/**
 * Student session controls: one obvious action at a time. Camera/analysis consent is collected
 * once at sign-up (privacy agreement), so the camera turns on only from this click.
 * E2E hooks: start-session, end-session, confirm-end, break-start, break-end (privacy-consent is a
 * pre-checked hidden input kept for the shared E2E helper).
 */
export function SessionControls({
  status,
  onBreak,
  onStart,
  onBreakStart,
  onBreakEnd,
  onEnd,
  busy = false,
  error = null,
}: SessionControlsProps) {
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const active = status === 'active';
  const canStart = !busy && (status === 'idle' || status === 'ended' || status === 'error');

  return (
    <section aria-labelledby="session-controls-title" className="flex flex-col items-center gap-4">
      <h2 id="session-controls-title" className="sr-only">
        학습 세션
      </h2>
      <input type="checkbox" data-testid="privacy-consent" checked readOnly hidden aria-hidden="true" tabIndex={-1} />

      {!active ? (
        <button type="button" data-testid="start-session" onClick={onStart} disabled={!canStart} className={`${PRIMARY} w-full max-w-xs`}>
          {status === 'starting' ? '시작하는 중…' : status === 'ended' ? '다시 공부 시작' : '공부 시작'}
        </button>
      ) : null}

      {active && !confirmingEnd ? (
        <div className="flex w-full max-w-sm items-center justify-center gap-2">
          {onBreak ? (
            <button type="button" data-testid="break-end" onClick={onBreakEnd} disabled={busy} className={`${PRIMARY} flex-1`}>
              다시 공부하기
            </button>
          ) : (
            <button type="button" data-testid="break-start" onClick={onBreakStart} disabled={busy} className={`${SECONDARY} flex-1`}>
              잠깐 쉬기
            </button>
          )}
          <button type="button" data-testid="end-session" onClick={() => setConfirmingEnd(true)} className={QUIET}>
            끝내기
          </button>
        </div>
      ) : null}

      {active && confirmingEnd ? (
        <div aria-live="polite" className="flex flex-col items-center">
          <p className="text-lg font-bold text-slate-900">오늘 공부를 마칠까요?</p>
          <p className="mt-1 text-sm text-slate-500">카메라가 꺼지고 이번 기록이 저장됩니다.</p>
          <div className="mt-5 flex gap-2">
            <button type="button" onClick={() => setConfirmingEnd(false)} disabled={busy} className={SECONDARY}>
              계속하기
            </button>
            <button
              type="button"
              data-testid="confirm-end"
              onClick={() => {
                setConfirmingEnd(false);
                onEnd();
              }}
              disabled={busy}
              className={`${BASE} bg-rose-600 text-white hover:bg-rose-500 focus-visible:outline-rose-700`}
            >
              마치기
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}
