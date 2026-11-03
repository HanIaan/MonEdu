'use client';
import { useRef, useState } from 'react';
import type { ApiError, StudyDayReport } from '@/lib/api';
import type { StudySessionApi } from '@/features/monitoring/contracts';
import { ErrorBanner } from '@/components/ErrorBanner';
import { EmptyState, CardSkeletonGrid } from '@/components/Skeleton';
import { CameraPanel } from './CameraPanel';
import { SessionControls } from './SessionControls';
import { LiveStats, deriveLiveValues, useNowMs } from './LiveStats';

export interface StudentStudyScreenProps {
  session: StudySessionApi;
  report: StudyDayReport | null;
  reportLoading: boolean;
  reportError: ApiError | null;
  /** Client receipt time of `report` (live ticking anchor). */
  fetchedAt: number | null;
  onRefreshReport: () => void;
  /** Live display tick in ms; 0 disables it (tests). */
  tickMs?: number;
}

function actionMessage(err: unknown): string {
  if (err instanceof Error && err.message && !/not integrated/i.test(err.message)) return err.message;
  return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

/**
 * Presentational student screen. Takes the session API and report via props so it can be tested
 * with a fake `StudySessionApi`; the real hook lives at the page level (`StudentScreen`).
 */
export function StudentStudyScreen({
  session,
  report,
  reportLoading,
  reportError,
  fetchedAt,
  onRefreshReport,
  tickMs = 1000,
}: StudentStudyScreenProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const busy = session.status === 'starting' || session.status === 'ending';
  const now = useNowMs(tickMs, Boolean(report));
  const liveValues = report ? deriveLiveValues(report, fetchedAt, now) : null;

  const requireVideo = (): HTMLVideoElement | null => {
    const video = videoRef.current;
    if (!video) {
      setActionError('카메라 미리보기를 준비하지 못했습니다. 페이지를 새로고침해 주세요.');
      return null;
    }
    return video;
  };

  const handleStart = () => {
    setActionError(null);
    // Called directly from the click handler so getUserMedia keeps the user gesture.
    void session.start().catch((err: unknown) => setActionError(actionMessage(err)));
  };

  const handleResume = () => {
    setActionError(null);
    void session.resumeMonitoring().catch((err: unknown) => setActionError(actionMessage(err)));
  };

  const handleEnd = () => {
    setActionError(null);
    void session.end().catch((err: unknown) => setActionError(actionMessage(err)));
  };

  return (
    <div className="space-y-6">
      {!session.sync.online ? (
        <ErrorBanner
          title="오프라인 상태입니다"
          message="네트워크 연결이 끊겼습니다. 상태 변화는 기기에 저장되었다가 연결되면 자동으로 전송됩니다."
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <CameraPanel
          videoRef={videoRef}
          cameraStatus={session.monitoring.cameraStatus}
          modelStatus={session.monitoring.modelStatus}
          engineState={session.monitoring.engineState}
          cameraError={session.monitoring.error}
        />

        <div className="space-y-4">
          <SessionControls
            status={session.status}
            monitoring={session.monitoring}
            consentAccepted={consentAccepted}
            onConsentChange={setConsentAccepted}
            onStart={handleStart}
            onBreakStart={() => {
              setActionError(null);
              session.startBreak();
            }}
            onBreakEnd={() => {
              setActionError(null);
              session.endBreak();
            }}
            onPause={() => {
              setActionError(null);
              session.pauseMonitoring();
            }}
            onResume={handleResume}
            onEnd={handleEnd}
            busy={busy}
            error={actionError}
          />

          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">시작하기 전에</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-slate-500">
              <li>카메라 권한을 허용해야 측정이 시작됩니다.</li>
              <li>브라우저 탭을 백그라운드로 두면 측정이 일시 중단되어 ‘측정 불가’로 기록됩니다.</li>
              <li>학습을 마치면 ‘학습 종료’를 눌러 세션을 정리해 주세요.</li>
            </ul>
          </div>
        </div>
      </div>

      {reportError ? (
        <ErrorBanner
          title={reportError.code === 'NETWORK_ERROR' ? '현황을 불러오지 못했습니다' : '학습 현황을 불러오지 못했습니다'}
          message={
            reportError.code === 'NETWORK_ERROR'
              ? '서버에 연결할 수 없습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.'
              : reportError.message
          }
          onRetry={onRefreshReport}
        />
      ) : null}

      {reportLoading && !report ? <CardSkeletonGrid count={8} /> : null}

      {!reportLoading && !report && !reportError ? (
        <EmptyState
          title="오늘의 학습 기록이 없습니다"
          description="학습을 시작하면 이곳에 상태별 누적 시간과 연속 집중 기록이 표시됩니다."
        />
      ) : null}

      {report && liveValues ? <LiveStats values={liveValues} sync={session.sync} /> : null}
    </div>
  );
}
