'use client';
import { useEffect, useState } from 'react';
import type { ActivityState, StudyDayReport } from '@/lib/api';
import type { LateStatus } from '@/lib/api';
import { formatDuration, formatSeoulTime } from '@/lib/time';
import { StatCard } from '@/components/StatCard';
import { StateBadge } from '@/components/StateBadge';
import type { SyncStatus } from '@/features/monitoring/contracts';

/** Values shown in the live panel. Durations are already live-ticked and floored. */
export interface LiveValues {
  referenceTime: string;
  firstSeatedAt: string | null;
  lateSeconds: number | null;
  lateStatus: LateStatus;
  currentState: ActivityState;
  currentStateSince: string | null;
  hasActiveSession: boolean;
  focusSeconds: number;
  currentStreakSeconds: number;
  longestStreakSeconds: number;
  awaySeconds: number;
  distractionSeconds: number;
  unknownSeconds: number;
  breakSeconds: number;
}

export interface LiveStatsProps {
  values: LiveValues;
  sync: SyncStatus;
  className?: string;
}

function SyncIndicator({ sync }: { sync: SyncStatus }) {
  const label = !sync.online
    ? `오프라인 · 저장 대기 ${sync.pendingEvents}건`
    : sync.pendingEvents > 0
      ? `동기화 대기 ${sync.pendingEvents}건`
      : '동기화됨';
  const dot = !sync.online ? 'bg-amber-500' : sync.pendingEvents > 0 ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div
      data-testid="sync-status"
      data-pending={sync.pendingEvents}
      aria-live="polite"
      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600"
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </div>
  );
}

function lateValue(values: LiveValues): string {
  if (values.lateStatus === 'NOT_SEATED') return '미착석';
  if (values.lateSeconds === null) return '—';
  if (values.lateSeconds === 0) return '정시';
  return formatDuration(values.lateSeconds);
}

/**
 * Live panel for the student study screen.
 * All durations render via formatDuration and expose `data-seconds` for E2E.
 */
export function LiveStats({ values, sync, className = '' }: LiveStatsProps) {
  return (
    <section aria-labelledby="live-stats-title" className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
        <div>
          <h2 id="live-stats-title" className="text-sm font-semibold text-slate-900">
            오늘의 학습 현황
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">기준 시각 09:00 (Asia/Seoul) · 표시된 시간은 초 단위 누적입니다.</p>
        </div>
        <SyncIndicator sync={sync} />
      </div>

      <div className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3" aria-live="polite">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500">현재 상태</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StateBadge testId="current-state" state={values.currentState} size="md" />
              <span className="text-sm text-slate-600">
                {values.hasActiveSession
                  ? values.currentStateSince
                    ? `${formatSeoulTime(values.currentStateSince)}부터`
                    : '방금 시작'
                  : '진행 중인 세션이 없습니다'}
              </span>
            </div>
          </div>
          <div className="ml-auto text-right">
            <p className="text-xs font-medium text-slate-500">첫 착석</p>
            <p data-testid="first-seated-at" className="mt-1 text-sm font-semibold tabular-nums text-slate-900">
              {values.firstSeatedAt ? formatSeoulTime(values.firstSeatedAt) : '아직 없음'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium text-slate-500">지각</p>
            <p
              data-testid="late-seconds"
              data-seconds={values.lateSeconds === null ? '' : Math.max(0, Math.floor(values.lateSeconds))}
              className={`mt-1 text-sm font-semibold tabular-nums ${
                values.lateStatus === 'LATE' ? 'text-rose-700' : values.lateStatus === 'ON_TIME' ? 'text-emerald-700' : 'text-slate-600'
              }`}
            >
              {lateValue(values)}
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          <StatCard label="기준 시각" value={formatSeoulTime(values.referenceTime)} tone="muted" />
          <StatCard
            label="오늘 총 집중 추정"
            value={formatDuration(values.focusSeconds)}
            seconds={values.focusSeconds}
            testId="focus-total"
            tone="focus"
          />
          <StatCard
            label="현재 연속 집중"
            value={formatDuration(values.currentStreakSeconds)}
            seconds={values.currentStreakSeconds}
            testId="current-streak"
            tone="focus"
          />
          <StatCard
            label="최장 연속 집중"
            value={formatDuration(values.longestStreakSeconds)}
            seconds={values.longestStreakSeconds}
            testId="longest-streak"
          />
          <StatCard
            label="자리비움 누적"
            value={formatDuration(values.awaySeconds)}
            seconds={values.awaySeconds}
            testId="away-total"
            tone="danger"
          />
          <StatCard
            label="비집중 의심 누적"
            value={formatDuration(values.distractionSeconds)}
            seconds={values.distractionSeconds}
            testId="distraction-total"
            tone="warn"
          />
          <StatCard
            label="측정 불가 누적"
            value={formatDuration(values.unknownSeconds)}
            seconds={values.unknownSeconds}
            testId="unknown-total"
            tone="muted"
          />
          <StatCard label="휴식 누적" value={formatDuration(values.breakSeconds)} tone="info" />
        </dl>

        <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
          모든 상태와 시간은 자동 분석에 따른 <strong className="font-semibold">추정</strong>이며, 확인된 사실이나
          징계의 근거가 아닙니다. 자리비움·비집중 의심·측정 불가 시간은 집중 시간에 포함되지 않습니다.
        </p>
      </div>
    </section>
  );
}

/** Advance a display clock at `intervalMs` (default 1 s). Elapsed time is derived from timestamps. */
export function useNowMs(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, enabled]);

  return now;
}

/**
 * Derive live display values from the last server report.
 * `extra` is elapsed time since the client received the report (not a tick count), so a
 * stalled tab does not inflate durations and a resumed tab catches up correctly.
 */
export function deriveLiveValues(report: StudyDayReport, fetchedAt: number | null, now: number): LiveValues {
  const open = report.intervals.find((interval) => interval.open) ?? null;
  const elapsed = open && fetchedAt !== null ? Math.max(0, Math.floor((now - fetchedAt) / 1000)) : 0;
  const add = (state: ActivityState, base: number) => base + (open?.state === state ? elapsed : 0);

  const currentStreakSeconds =
    open?.state === 'FOCUS_ESTIMATED' ? report.currentStreakSeconds + elapsed : report.currentStreakSeconds;

  return {
    referenceTime: report.referenceTime,
    firstSeatedAt: report.firstSeatedAt ?? null,
    lateSeconds: report.lateSeconds ?? null,
    lateStatus: report.lateStatus,
    currentState: report.currentState ?? 'UNKNOWN',
    currentStateSince: report.currentStateSince ?? null,
    hasActiveSession: Boolean(report.activeSessionId),
    focusSeconds: add('FOCUS_ESTIMATED', report.totals.focusSeconds),
    currentStreakSeconds,
    longestStreakSeconds: Math.max(report.longestStreakSeconds, currentStreakSeconds),
    awaySeconds: add('AWAY', report.totals.awaySeconds),
    distractionSeconds: add('DISTRACTION_SUSPECTED', report.totals.distractionSeconds),
    unknownSeconds: add('UNKNOWN', report.totals.unknownSeconds),
    breakSeconds: add('BREAK', report.totals.breakSeconds),
  };
}
