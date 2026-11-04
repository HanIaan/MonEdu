'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type {
  ActivityState,
  CameraStatus,
  ClientTransitionReason,
  FrameObservation,
  ModelStatus,
  MonitoringPerf,
  SessionStatus,
} from '@/features/monitoring/contracts';
import {
  CAMERA_STATUS_DETAIL,
  CAMERA_STATUS_LABEL,
  MODEL_STATUS_DETAIL,
  MODEL_STATUS_LABEL,
  TONE_DOT,
  TONE_TEXT,
  cameraNeedsAttention,
  cameraStatusTone,
  deriveUnavailableReason,
  modelNeedsAttention,
  modelStatusTone,
  transitionReasonText,
} from './status';

const FRAMING_STORAGE_KEY = 'sm.framingDone';

function readFramingDone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(FRAMING_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeFramingDone(): void {
  try {
    window.localStorage.setItem(FRAMING_STORAGE_KEY, '1');
  } catch {
    /* storage unavailable (private mode) — completion is session-scoped */
  }
}

/** Rolling analysis rate from the monotonic `framesProcessed` counter over elapsed time. */
function useAnalysisFps(framesProcessed: number, active: boolean): number {
  const framesRef = useRef(framesProcessed);
  const lastRef = useRef({ frames: framesProcessed, at: 0 });
  const [fps, setFps] = useState(0);

  // Keep the latest counter available to the sampling interval without ref writes during render.
  useEffect(() => {
    framesRef.current = framesProcessed;
  }, [framesProcessed]);

  useEffect(() => {
    if (!active) return;
    lastRef.current = { frames: framesRef.current, at: Date.now() };
    const timer = setInterval(() => {
      const now = Date.now();
      const elapsedSec = Math.max(0.001, (now - lastRef.current.at) / 1000);
      const delta = Math.max(0, framesRef.current - lastRef.current.frames);
      setFps(Math.round((delta / elapsedSec) * 10) / 10);
      lastRef.current = { frames: framesRef.current, at: now };
    }, 1000);
    return () => clearInterval(timer);
  }, [active]);

  return active ? fps : 0;
}

function StatusRow({
  label,
  value,
  tone,
  testId,
  dataStatus,
  dataFps,
}: {
  label: string;
  value: string;
  tone: 'ok' | 'warn' | 'bad' | 'idle';
  testId: string;
  dataStatus?: string;
  dataFps?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd
        data-testid={testId}
        data-status={dataStatus}
        data-fps={dataFps}
        className={`inline-flex items-center gap-1.5 text-xs font-semibold ${TONE_TEXT[tone]}`}
      >
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${TONE_DOT[tone]}`} />
        {value}
      </dd>
    </div>
  );
}

export interface MonitoringCardProps {
  cameraStatus: CameraStatus;
  modelStatus: ModelStatus;
  engineState: ActivityState;
  lastObservation: FrameObservation | null;
  framesProcessed: number;
  paused: boolean;
  /** Student-declared break: the camera is off on purpose, so no resume control is offered. */
  onBreak?: boolean;
  sessionStatus: SessionStatus;
  /** Preview only — never used for inference. */
  cameraStream: MediaStream | null;
  cameraError?: string | null;
  /** Epoch ms of the last processed frame (stall detection). */
  lastFrameAt?: number | null;
  /** v1.2 perf telemetry; adaptive-cadence fields may be undefined until the engine reports them. */
  perf?: MonitoringPerf;
  /**
   * v1.2 optional: reason of the engine's latest transition. When defined (non-null), it is the
   * authoritative cause for an UNKNOWN state; otherwise the cause is derived from status fields.
   */
  lastReason?: ClientTransitionReason | null;
  /** Client network state; false hints at a heartbeat timeout. */
  online?: boolean;
  /** Injected clock for deterministic cause derivation (tests). */
  now?: number;
  onPause: () => void;
  onResume: () => void;
}

/**
 * Compact "AI 집중 모니터링" status card. The camera image is not shown by default:
 * the screen is about study stats. An optional preview (bound read-only to `cameraStream`)
 * is mounted only while open; it never calls start/pause.
 */
export function MonitoringCard({
  cameraStatus,
  modelStatus,
  engineState,
  lastObservation,
  framesProcessed,
  paused,
  onBreak = false,
  sessionStatus,
  cameraStream,
  cameraError,
  lastFrameAt = null,
  perf,
  lastReason,
  online,
  now,
  onPause,
  onResume,
}: MonitoringCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [framingDone, setFramingDone] = useState<boolean>(readFramingDone);
  const autoOpenedRef = useRef(false);
  const previewRef = useRef<HTMLVideoElement | null>(null);

  const cameraLive = cameraStatus === 'active';
  const measuring = cameraLive && !paused;
  const fps = useAnalysisFps(framesProcessed, measuring);
  const sessionActive = sessionStatus === 'active';
  const faceOk = cameraLive && Boolean(lastObservation?.faceDetected);
  const bodyOk = cameraLive && Boolean(lastObservation?.upperBodyDetected);

  const unavailableReason =
    engineState === 'UNKNOWN'
      ? lastReason ??
        deriveUnavailableReason({
          engineState,
          cameraStatus,
          modelStatus,
          paused,
          lastFrameAt,
          now: now ?? 0,
          online,
        })
      : null;
  const unavailableText =
    transitionReasonText(unavailableReason) ??
    (sessionActive ? '측정 근거가 충분하지 않습니다.' : '아직 모니터링이 시작되지 않았습니다.');
  const needsRetry =
    sessionActive && !paused && (cameraNeedsAttention(cameraStatus) || modelNeedsAttention(modelStatus));

  const lowPower = perf?.lowPower === true;
  const intervalSeconds = perf?.effectiveIntervalMs !== undefined ? perf.effectiveIntervalMs / 1000 : null;
  const intervalLabel =
    intervalSeconds === null
      ? '감지 간격 조정됨'
      : `감지 간격 ${Number.isInteger(intervalSeconds) ? intervalSeconds : intervalSeconds.toFixed(1)}초`;
  const lowPowerTooltip =
    intervalSeconds === null
      ? '기기 성능에 맞춰 감지 간격을 늘렸습니다. 상태 변화 반영이 조금 늦을 수 있지만 학습 시간 계산은 동일합니다.'
      : `기기 성능에 맞춰 감지 간격을 ${Number.isInteger(intervalSeconds) ? intervalSeconds : intervalSeconds.toFixed(1)}초로 늘렸습니다. 상태 변화가 최대 ${Number.isInteger(intervalSeconds) ? intervalSeconds : intervalSeconds.toFixed(1)}초 늦게 반영될 수 있지만, 학습 시간 계산은 동일합니다.`;

  // First-time setup: the first time the camera becomes active, offer a framing check.
  useEffect(() => {
    if (!cameraLive || framingDone || autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    // Deferred so the effect does not cascade a synchronous render.
    const timer = setTimeout(() => setPreviewOpen(true), 0);
    return () => clearTimeout(timer);
  }, [cameraLive, framingDone]);

  // Bind/unbind the preview-only stream. The analysis video belongs to the session layer.
  useEffect(() => {
    if (!previewOpen) return;
    const element = previewRef.current;
    if (!element) return;
    element.srcObject = cameraStream;
    try {
      const played = element.play?.();
      if (played && typeof played.catch === 'function') played.catch(() => undefined);
    } catch {
      /* autoplay refusal is fine for a preview */
    }
    return () => {
      element.srcObject = null;
    };
  }, [previewOpen, cameraStream]);

  const completeFraming = () => {
    setFramingDone(true);
    setPreviewOpen(false);
    writeFramingDone();
  };

  const unknownBlock =
    engineState === 'UNKNOWN' ? (
      <div
        data-testid="unknown-state"
        data-reason={unavailableReason ?? 'NONE'}
        className="flex items-center gap-3 rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-900">기록이 잠시 멈췄어요</p>
          <p data-testid="unknown-state-reason" className="mt-0.5 text-sm text-slate-600">
            {unavailableText}
          </p>
        </div>
        {needsRetry ? (
          <button
            type="button"
            data-testid="monitoring-retry"
            onClick={onResume}
            className="shrink-0 rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            다시 시도
          </button>
        ) : null}
      </div>
    ) : null;

  // Only causes the student can act on are shown; the start-up wait and low-confidence moments are not.
  const showUnknown =
    sessionActive &&
    unknownBlock !== null &&
    (needsRetry ||
      (unavailableReason !== null && unavailableReason !== 'LOW_CONFIDENCE' && unavailableReason !== 'MONITORING_PAUSED'));

  const link =
    'rounded-full px-3 py-1.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';

  return (
    <section data-testid="monitoring-card" aria-labelledby="monitoring-card-title" aria-live="polite">
      <h2 id="monitoring-card-title" className="sr-only">
        {cameraLive ? 'AI 집중 모니터링 작동 중' : 'AI 집중 모니터링'}
      </h2>

      {showUnknown ? <div className="mb-4">{unknownBlock}</div> : null}

      {/* The unknown-state block already explains the cause; the raw error stays in the diagnostics. */}
      {cameraError && !showUnknown ? (
        <p role="alert" className="mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          {cameraError}
        </p>
      ) : null}

      {previewOpen ? (
        <div id="camera-preview-panel" className="mb-4 space-y-3">
          <video
            ref={previewRef}
            data-testid="camera-preview"
            muted
            playsInline
            autoPlay
            aria-label="카메라 미리보기"
            // Mirrored like a selfie camera; display only (the analysis video is untouched).
            className="aspect-video w-full -scale-x-100 rounded-3xl bg-black object-cover"
          />
          {cameraLive ? (
            <div className="rounded-2xl bg-slate-50 p-4 text-left">
              <p className="text-sm font-semibold text-slate-900">얼굴과 어깨가 화면 안에 들어오게 앉아 주세요.</p>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <li
                  data-testid="framing-face"
                  data-ok={faceOk ? 'true' : 'false'}
                  className={faceOk ? 'font-semibold text-emerald-700' : 'text-amber-700'}
                >
                  {faceOk ? '✓' : '·'} 얼굴 {faceOk ? '확인됨' : '인식되지 않음'}
                </li>
                <li
                  data-testid="framing-body"
                  data-ok={bodyOk ? 'true' : 'false'}
                  className={bodyOk ? 'font-semibold text-emerald-700' : 'text-amber-700'}
                >
                  {bodyOk ? '✓' : '·'} 어깨 {bodyOk ? '확인됨' : '인식되지 않음'}
                </li>
              </ul>
              {!framingDone ? (
                <button
                  type="button"
                  data-testid="framing-done"
                  onClick={completeFraming}
                  className="mt-3 h-11 w-full rounded-full bg-slate-900 px-3 text-sm font-bold text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                >
                  확인했어요
                </button>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-slate-500">카메라가 켜지면 이곳에 미리보기가 표시됩니다.</p>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-2 border-t border-slate-200 pt-4">
        <p
          data-testid="camera-status"
          data-status={cameraStatus}
          className={`mr-auto inline-flex items-center gap-2 text-sm font-semibold ${TONE_TEXT[cameraStatusTone(cameraStatus)]}`}
        >
          {cameraLive ? (
            <span data-testid="camera-active-indicator" className="inline-flex items-center gap-2 text-slate-900">
              <span aria-hidden="true" className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
              </span>
              카메라 작동 중
            </span>
          ) : onBreak ? (
            <>
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-blue-400" />
              <span className="text-slate-700">
                쉬는 동안 카메라 꺼짐<span className="sr-only"> ({CAMERA_STATUS_LABEL[cameraStatus]})</span>
              </span>
            </>
          ) : (
            <>
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${TONE_DOT[cameraStatusTone(cameraStatus)]}`} />
              <span>
                카메라 <span className="font-medium">{CAMERA_STATUS_LABEL[cameraStatus]}</span>
              </span>
            </>
          )}
        </p>

        <button
          type="button"
          data-testid="preview-toggle"
          aria-expanded={previewOpen}
          aria-controls="camera-preview-panel"
          onClick={() => setPreviewOpen((open) => !open)}
          className={link}
        >
          {previewOpen ? '미리보기 닫기' : '미리보기 확인'}
        </button>

        {sessionActive && !onBreak ? (
          paused ? (
            <button type="button" data-testid="resume-monitoring" onClick={onResume} className={link}>
              카메라 다시 켜기
            </button>
          ) : (
            <button type="button" data-testid="pause-monitoring" onClick={onPause} className={link}>
              카메라 잠시 끄기
            </button>
          )
        ) : null}
      </div>

      <p data-testid="privacy-notice" className="mt-3 flex items-start justify-center gap-1.5 text-center text-xs leading-relaxed text-slate-500">
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="mt-0.5 h-3.5 w-3.5 shrink-0">
          <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
          <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" strokeLinecap="round" />
        </svg>
        <span>
          영상은 브라우저 안에서만 분석되며 서버로 전송되거나 저장되지 않습니다.{' '}
          <Link href="/privacy" target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2 hover:text-slate-900">
            개인정보 처리 안내
          </Link>
        </span>
      </p>

      {/*
        Engine diagnostics are not shown to students. They stay in the DOM (hidden) as machine-readable
        status for support and the E2E/unit hooks (model-status, analysis-fps, causes, low-power).
      */}
      <div hidden>
        <dl>
          <StatusRow
            label="AI 모델"
            value={MODEL_STATUS_LABEL[modelStatus]}
            tone={modelStatusTone(modelStatus)}
            testId="model-status"
            dataStatus={modelStatus}
          />
          <StatusRow
            label="분석 속도"
            value={measuring && fps > 0 ? `${fps.toFixed(1)} fps` : measuring ? '측정 중…' : '—'}
            tone={measuring ? 'ok' : 'idle'}
            testId="analysis-fps"
            // Raw rate; 0 when the camera is not measuring.
            dataFps={fps.toFixed(1)}
          />
          {perf?.p95InferenceMs !== undefined ? (
            <StatusRow
              label="p95 추론 시간"
              value={`${Math.round(perf.p95InferenceMs)} ms`}
              tone="ok"
              testId="p95-inference"
            />
          ) : null}
        </dl>
        <p data-testid="camera-status-cause" data-status={cameraStatus}>
          {cameraError ?? CAMERA_STATUS_DETAIL[cameraStatus]}
        </p>
        <p data-testid="model-status-cause" data-status={modelStatus}>
          {MODEL_STATUS_DETAIL[modelStatus]}
        </p>
        {lowPower ? (
          <p data-testid="low-power-notice" data-interval-ms={perf?.effectiveIntervalMs}>
            저사양 모드: {intervalLabel} — {lowPowerTooltip}
          </p>
        ) : null}
        {!showUnknown ? unknownBlock : null}
      </div>
    </section>
  );
}
