'use client';
import { memo, useCallback, useMemo, useState } from 'react';
import type { ApiError, StudyDayReport } from '@/lib/api';
import type { StudySessionApi } from '@/features/monitoring/contracts';
import { ErrorBanner } from '@/components/ErrorBanner';
import { EmptyState, CardSkeletonGrid } from '@/components/Skeleton';
import { Timeline } from '@/components/Timeline';
import { MonitoringCard } from './MonitoringCard';
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

/**
 * Memo boundaries: the 4 Hz monitoring snapshot lives only in the monitoring/status card.
 * The timeline, live stats and session controls receive stable props (or primitives), so a
 * snapshot tick no longer re-renders them (P2-W3 step 1).
 */
const MemoTimeline = memo(Timeline);
const MemoLiveStats = memo(LiveStats);
const MemoSessionControls = memo(SessionControls);

function actionMessage(err: unknown): string {
  if (err instanceof Error && err.message && !/not integrated/i.test(err.message)) return err.message;
  return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

/**
 * Student study screen centred on the day's focus stats and timeline.
 * The camera is only a small status card (with an opt-in preview); the session layer owns the
 * analysis video, so this component calls `start()`/`resumeMonitoring()` with no video argument.
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
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const busy = session.status === 'starting' || session.status === 'ending';
  const now = useNowMs(tickMs, Boolean(report));
  // Stable between snapshot ticks: `now` only advances on the display tick.
  const liveValues = useMemo(
    () => (report ? deriveLiveValues(report, fetchedAt, now) : null),
    [report, fetchedAt, now],
  );

  // Session methods are stable across snapshot ticks; depend on them directly so the memoised
  // session controls are not invalidated by the 4 Hz snapshot.
  const { start, end, resumeMonitoring, pauseMonitoring, startBreak, endBreak } = session;

  const handleStart = useCallback(() => {
    setActionError(null);
    // Called directly from the click handler so getUserMedia keeps the user gesture.
    void start().catch((err: unknown) => setActionError(actionMessage(err)));
  }, [start]);

  const handleResume = useCallback(() => {
    setActionError(null);
    void resumeMonitoring().catch((err: unknown) => setActionError(actionMessage(err)));
  }, [resumeMonitoring]);

  const handlePause = useCallback(() => {
    setActionError(null);
    pauseMonitoring();
  }, [pauseMonitoring]);

  const handleBreakStart = useCallback(() => {
    setActionError(null);
    startBreak();
  }, [startBreak]);

  const handleBreakEnd = useCallback(() => {
    setActionError(null);
    endBreak();
  }, [endBreak]);

  const handleEnd = useCallback(() => {
    setActionError(null);
    void end().catch((err: unknown) => setActionError(actionMessage(err)));
  }, [end]);

  return (
    <div className="space-y-6">
      {!session.sync.online ? (
        <ErrorBanner
          title="오프라인 상태입니다"
          message="네트워크 연결이 끊겼습니다. 상태 변화는 기기에 저장되었다가 연결되면 자동으로 전송됩니다."
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <aside className="space-y-4 lg:col-start-2 lg:row-start-1" aria-label="모니터링 및 세션 제어">
          <MonitoringCard
            cameraStatus={session.monitoring.cameraStatus}
            modelStatus={session.monitoring.modelStatus}
            engineState={session.monitoring.engineState}
            lastObservation={session.monitoring.lastObservation}
            framesProcessed={session.monitoring.perf.framesProcessed}
            paused={session.monitoring.paused}
            sessionStatus={session.status}
            cameraStream={session.cameraStream}
            cameraError={session.monitoring.error}
            lastFrameAt={session.monitoring.lastFrameAt}
            online={session.sync.online}
            now={now}
            onPause={handlePause}
            onResume={handleResume}
          />

          <MemoSessionControls
            status={session.status}
            onBreak={session.monitoring.onBreak}
            consentAccepted={consentAccepted}
            onConsentChange={setConsentAccepted}
            onStart={handleStart}
            onBreakStart={handleBreakStart}
            onBreakEnd={handleBreakEnd}
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
        </aside>

        <div className="space-y-6 lg:col-start-1 lg:row-start-1">
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

          {report && liveValues ? <MemoLiveStats values={liveValues} sync={session.sync} /> : null}

          {report ? (
            <section
              aria-labelledby="student-timeline-title"
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 id="student-timeline-title" className="text-sm font-semibold text-slate-900">
                  오늘의 활동 타임라인
                </h2>
                <p className="text-xs text-slate-500">구간에 마우스를 올리거나 포커스하면 상세가 표시됩니다.</p>
              </div>
              <MemoTimeline intervals={report.intervals} computedAt={report.computedAt} />
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
