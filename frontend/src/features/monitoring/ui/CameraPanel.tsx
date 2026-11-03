import type { RefObject } from 'react';
import type { ActivityState, CameraStatus, ModelStatus } from '@/features/monitoring/contracts';
import { StateBadge } from '@/components/StateBadge';
import {
  CAMERA_STATUS_LABEL,
  MODEL_STATUS_LABEL,
  TONE_DOT,
  TONE_TEXT,
  cameraStatusTone,
  modelStatusTone,
} from './status';

export interface CameraPanelProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  cameraStatus: CameraStatus;
  modelStatus: ModelStatus;
  engineState: ActivityState;
  cameraError?: string | null;
}

function StatusRow({
  label,
  value,
  tone,
  testId,
  dataStatus,
}: {
  label: string;
  value: string;
  tone: 'ok' | 'warn' | 'bad' | 'idle';
  testId: string;
  dataStatus: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd
        data-testid={testId}
        data-status={dataStatus}
        className={`inline-flex items-center gap-1.5 text-xs font-semibold ${TONE_TEXT[tone]}`}
      >
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${TONE_DOT[tone]}`} />
        {value}
      </dd>
    </div>
  );
}

/**
 * Always-visible camera state. The `<video>` element is mounted before the camera starts so
 * `session.start(videoEl)` can receive the same node from the click handler.
 */
export function CameraPanel({ videoRef, cameraStatus, modelStatus, engineState, cameraError }: CameraPanelProps) {
  const live = cameraStatus === 'active' || cameraStatus === 'requesting';

  return (
    <section aria-labelledby="camera-panel-title" className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <h2 id="camera-panel-title" className="text-sm font-semibold text-slate-900">
          카메라
        </h2>
        <StateBadge state={engineState} />
      </div>

      <div className="p-4">
        <div className="relative overflow-hidden rounded-lg bg-slate-900">
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            aria-label="내 카메라 미리보기"
            className={`aspect-video w-full object-cover ${live ? 'opacity-100' : 'opacity-0'}`}
          />
          {!live ? (
            <div className="absolute inset-0 grid place-items-center bg-slate-900 px-4 text-center">
              <div>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  className="mx-auto h-8 w-8 text-slate-500"
                >
                  <path d="M4 7.5h3.2l1.6-2h6.4l1.6 2H20a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
                  <circle cx="12" cy="13" r="3.2" />
                </svg>
                <p className="mt-2 text-xs text-slate-400">카메라가 꺼져 있습니다</p>
              </div>
            </div>
          ) : null}
        </div>

        <dl aria-live="polite" className="mt-3 divide-y divide-slate-100">
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
        </dl>

        {cameraError ? (
          <p role="alert" className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {cameraError}
          </p>
        ) : null}

        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
          <span aria-hidden="true" className="mt-0.5 font-bold text-emerald-600">
            ●
          </span>
          영상은 브라우저 안에서만 분석되며, 서버로 전송되거나 저장되지 않습니다.
        </p>
      </div>
    </section>
  );
}
