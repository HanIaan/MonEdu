'use client';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { ApiError, StudyDayReport } from '@/lib/api';
import type { StudySessionApi } from '@/features/monitoring/contracts';
import { ErrorBanner } from '@/components/ErrorBanner';
import { EmptyState, CardSkeletonGrid } from '@/components/Skeleton';
import { STUDENT_STATE_LABEL } from '@/components/StateBadge';
import { Timeline } from '@/components/Timeline';
import { MonitoringCard } from './MonitoringCard';
import { SessionControls } from './SessionControls';
import { DayFacts, LiveStats, deriveLiveValues, useNowMs } from './LiveStats';

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
const MemoDayFacts = memo(DayFacts);
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

  // A break turns the camera off (nothing is measured anyway) and ending it turns it back on.
  // Order matters: BREAK first, so the camera pause does not record a "paused" interval.
  const handleBreakStart = useCallback(() => {
    setActionError(null);
    startBreak();
    pauseMonitoring();
  }, [startBreak, pauseMonitoring]);

  const handleBreakEnd = useCallback(() => {
    setActionError(null);
    endBreak();
    void resumeMonitoring().catch((err: unknown) => setActionError(actionMessage(err)));
  }, [endBreak, resumeMonitoring]);

  const handleEnd = useCallback(() => {
    setActionError(null);
    void end().catch((err: unknown) => setActionError(actionMessage(err)));
  }, [end]);

  // Lets the app shell warn before in-app navigation would stop the camera mid-session.
  const studying = session.status === 'active';
  useEffect(() => {
    if (!studying) return;
    document.body.dataset.studyActive = '1';
    return () => {
      delete document.body.dataset.studyActive;
    };
  }, [studying]);

  return (
    <div className="mx-auto w-full max-w-7xl">
      <div className="mb-8 space-y-3 empty:hidden">
        {!session.sync.online ? (
          <ErrorBanner
            title="오프라인 상태입니다"
            message="네트워크 연결이 끊겼습니다. 상태 변화는 기기에 저장되었다가 연결되면 자동으로 전송됩니다."
          />
        ) : null}

        {reportError ? (
          <ErrorBanner
            title={
              reportError.code === 'NETWORK_ERROR' ? '현황을 불러오지 못했습니다' : '학습 현황을 불러오지 못했습니다'
            }
            message={
              reportError.code === 'NETWORK_ERROR'
                ? '서버에 연결할 수 없습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.'
                : reportError.message
            }
            onRetry={onRefreshReport}
          />
        ) : null}
      </div>

      <div className="pt-4 sm:pt-10">
        {reportLoading && !report ? <CardSkeletonGrid count={2} /> : null}

        {!reportLoading && !report && !reportError ? (
          <EmptyState
            title="오늘은 아직 기록이 없어요"
            description="공부를 시작하면 오늘 공부한 시간이 여기에 쌓여요."
          />
        ) : null}

        {report && liveValues ? <MemoLiveStats values={liveValues} sync={session.sync} showDayFacts={false} /> : null}

        <div className={report ? 'mt-12' : 'mt-8'}>
          <MemoSessionControls
            status={session.status}
            onBreak={session.monitoring.onBreak}
            onStart={handleStart}
            onBreakStart={handleBreakStart}
            onBreakEnd={handleBreakEnd}
            onEnd={handleEnd}
            busy={busy}
            error={actionError}
          />
        </div>
      </div>

      {report ? (
        <section aria-labelledby="student-timeline-title" className="mx-auto mt-16 max-w-xl lg:max-w-none">
          <h2 id="student-timeline-title" className="mb-4 text-center text-sm font-semibold text-slate-500">
            오늘 공부 시간
          </h2>
          <MemoTimeline intervals={report.intervals} computedAt={report.computedAt} labels={STUDENT_STATE_LABEL} fillGaps />
          {liveValues ? <MemoDayFacts values={liveValues} className="mt-6" /> : null}
        </section>
      ) : null}

      <div className="mx-auto mt-16 max-w-xl lg:max-w-none">
        <MonitoringCard
          cameraStatus={session.monitoring.cameraStatus}
          modelStatus={session.monitoring.modelStatus}
          engineState={session.monitoring.engineState}
          lastObservation={session.monitoring.lastObservation}
          framesProcessed={session.monitoring.perf.framesProcessed}
          perf={session.monitoring.perf}
          lastReason={session.monitoring.lastReason}
          paused={session.monitoring.paused}
          onBreak={session.monitoring.onBreak}
          sessionStatus={session.status}
          cameraStream={session.cameraStream}
          cameraError={session.monitoring.error}
          lastFrameAt={session.monitoring.lastFrameAt}
          online={session.sync.online}
          now={now}
          onPause={handlePause}
          onResume={handleResume}
        />
      </div>
    </div>
  );
}
