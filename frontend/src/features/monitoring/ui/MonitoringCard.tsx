'use client';
import { useEffect, useRef, useState } from 'react';
import type { ActivityState, CameraStatus, FrameObservation, ModelStatus, SessionStatus } from '@/features/monitoring/contracts';
import { StateBadge } from '@/components/StateBadge';
import {
  CAMERA_STATUS_LABEL,
  MODEL_STATUS_LABEL,
  TONE_DOT,
  TONE_TEXT,
  cameraStatusTone,
  modelStatusTone,
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
    <div className="flex items-center justify-between gap-3 py-1">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
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
  sessionStatus: SessionStatus;
  /** Preview only — never used for inference. */
  cameraStream: MediaStream | null;
  cameraError?: string | null;
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
  sessionStatus,
  cameraStream,
  cameraError,
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

  return (
    <section
      data-testid="monitoring-card"
      aria-labelledby="monitoring-card-title"
      aria-live="polite"
      className="rounded-xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 id="monitoring-card-title" className="text-sm font-semibold text-slate-900">
          {cameraLive ? 'AI 집중 모니터링 작동 중' : 'AI 집중 모니터링'}
        </h2>
        <StateBadge state={engineState} />
      </div>

      <div className="space-y-3 p-4">
        {cameraLive ? (
          <p className="flex items-center gap-2 rounded-md bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
            <span aria-hidden="true" className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
            </span>
            카메라 작동 중
          </p>
        ) : (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
            카메라가 꺼져 있습니다. ‘학습 시작’을 누르면 모니터링이 시작됩니다.
          </p>
        )}

        <dl className="divide-y divide-slate-100">
          <StatusRow
            label="카메라 상태"
            value={CAMERA_STATUS_LABEL[cameraStatus]}
            tone={cameraStatusTone(cameraStatus)}
            testId="camera-status"
            dataStatus={cameraStatus}
          />
          <StatusRow
            label="모델 상태"
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
        </dl>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            data-testid="pause-monitoring"
            onClick={onPause}
            disabled={!sessionActive || paused}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            모니터링 중단
          </button>
          <button
            type="button"
            data-testid="resume-monitoring"
            onClick={onResume}
            disabled={!sessionActive || !paused}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            모니터링 재개
          </button>
        </div>

        <button
          type="button"
          data-testid="preview-toggle"
          aria-expanded={previewOpen}
          aria-controls="camera-preview-panel"
          onClick={() => setPreviewOpen((open) => !open)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {previewOpen ? '미리보기 닫기' : '미리보기 확인'}
        </button>

        {previewOpen ? (
          <div id="camera-preview-panel" className="space-y-2">
            <video
              ref={previewRef}
              data-testid="camera-preview"
              muted
              playsInline
              autoPlay
              aria-label="카메라 미리보기"
              className="aspect-video w-full rounded-lg bg-slate-900 object-cover"
            />
            {cameraLive ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-700">얼굴과 어깨가 화면 안에 들어오게 앉아 주세요.</p>
                <ul className="mt-2 space-y-1 text-xs">
                  <li
                    data-testid="framing-face"
                    data-ok={faceOk ? 'true' : 'false'}
                    className={faceOk ? 'font-medium text-emerald-700' : 'text-amber-700'}
                  >
                    {faceOk ? '✓' : '·'} 얼굴 {faceOk ? '확인됨' : '인식되지 않음'}
                  </li>
                  <li
                    data-testid="framing-body"
                    data-ok={bodyOk ? 'true' : 'false'}
                    className={bodyOk ? 'font-medium text-emerald-700' : 'text-amber-700'}
                  >
                    {bodyOk ? '✓' : '·'} 어깨 {bodyOk ? '확인됨' : '인식되지 않음'}
                  </li>
                </ul>
                {!framingDone ? (
                  <button
                    type="button"
                    data-testid="framing-done"
                    onClick={completeFraming}
                    className="mt-3 w-full rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                  >
                    확인했어요
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                카메라가 켜지면 이곳에 미리보기가 표시됩니다.
              </p>
            )}
          </div>
        ) : null}

        {cameraError ? (
          <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {cameraError}
          </p>
        ) : null}

        <p className="text-[11px] leading-relaxed text-slate-500">
          영상은 브라우저 안에서만 분석되며 서버로 전송·저장되지 않습니다. 미리보기는 보기 전용이며 분석을
          제어하지 않습니다.
        </p>
      </div>
    </section>
  );
}
