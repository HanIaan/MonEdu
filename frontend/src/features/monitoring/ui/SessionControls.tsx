'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { SessionStatus } from '@/features/monitoring/contracts';

export interface SessionControlsProps {
  status: SessionStatus;
  /** True while the student-declared break is active (primitive keeps this component memo-safe). */
  onBreak: boolean;
  consentAccepted: boolean;
  onConsentChange: (accepted: boolean) => void;
  onStart: () => void;
  onBreakStart: () => void;
  onBreakEnd: () => void;
  onEnd: () => void;
  busy?: boolean;
  error?: string | null;
}

const PRIMARY =
  'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY_ON = `${PRIMARY} bg-slate-900 text-white hover:bg-slate-800 focus-visible:outline-slate-900`;
const SECONDARY = `${PRIMARY} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:outline-slate-900`;
const DANGER = `${PRIMARY} border border-rose-300 bg-white text-rose-700 hover:bg-rose-50 focus-visible:outline-rose-700`;

/**
 * Student session controls. The start button calls `start(videoEl)` from the click handler
 * (user gesture) via the parent. E2E hooks: privacy-consent, start-session, end-session,
 * confirm-end, break-start, break-end, pause-monitoring, resume-monitoring.
 */
export function SessionControls({
  status,
  onBreak,
  consentAccepted,
  onConsentChange,
  onStart,
  onBreakStart,
  onBreakEnd,
  onEnd,
  busy = false,
  error = null,
}: SessionControlsProps) {
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const active = status === 'active';
  const canStart =
    consentAccepted && !busy && (status === 'idle' || status === 'ended' || status === 'error');

  return (
    <section aria-labelledby="session-controls-title" className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 id="session-controls-title" className="text-sm font-semibold text-slate-900">
          학습 세션
        </h2>
      </div>

      <div className="space-y-4 p-4">
        <label
          htmlFor="privacy-consent"
          className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
        >
          <input
            id="privacy-consent"
            data-testid="privacy-consent"
            type="checkbox"
            checked={consentAccepted}
            onChange={(e) => onConsentChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-400 text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          />
          <span>
            카메라 영상이 <strong className="font-semibold">브라우저 안에서만</strong> 분석되고 서버에는 상태
            변화 시각만 저장되는 것에 동의합니다.{' '}
            <Link
              href="/privacy"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-slate-900 underline underline-offset-2"
            >
              개인정보 처리 안내
            </Link>
          </span>
        </label>

        {!active ? (
          <button type="button" data-testid="start-session" onClick={onStart} disabled={!canStart} className={`${PRIMARY_ON} w-full`}>
            학습 시작
          </button>
        ) : null}

        {!active ? (
          <p className="text-xs leading-relaxed text-slate-500">
            학습을 시작하면 서버 세션이 열리고 카메라·분석이 시작됩니다. 시작 전에 반드시 동의가 필요합니다.
          </p>
        ) : null}

        {active ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              data-testid="break-start"
              onClick={onBreakStart}
              disabled={busy || onBreak}
              className={SECONDARY}
            >
              휴식 시작
            </button>
            <button
              type="button"
              data-testid="break-end"
              onClick={onBreakEnd}
              disabled={busy || !onBreak}
              className={SECONDARY}
            >
              휴식 종료
            </button>
          </div>
        ) : null}

        {active && !confirmingEnd ? (
          <button type="button" data-testid="end-session" onClick={() => setConfirmingEnd(true)} className={`${DANGER} w-full`}>
            학습 종료
          </button>
        ) : null}

        {active && confirmingEnd ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3" aria-live="polite">
            <p className="text-sm font-medium text-rose-800">학습을 종료할까요?</p>
            <p className="mt-1 text-xs text-rose-700">
              종료하면 오늘의 이 세션 기록이 마감되고 모니터링이 중단됩니다.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                data-testid="confirm-end"
                onClick={() => {
                  setConfirmingEnd(false);
                  onEnd();
                }}
                disabled={busy}
                className={`${PRIMARY} bg-rose-600 text-white hover:bg-rose-700 focus-visible:outline-rose-700`}
              >
                종료 확인
              </button>
              <button type="button" onClick={() => setConfirmingEnd(false)} disabled={busy} className={SECONDARY}>
                취소
              </button>
            </div>
          </div>
        ) : null}

        {status === 'ended' ? (
          <p role="status" className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600">
            학습이 종료되었습니다. 필요하면 다시 시작할 수 있습니다.
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
