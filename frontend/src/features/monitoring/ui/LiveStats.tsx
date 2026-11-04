'use client';
import { useEffect, useState } from 'react';
import type { ActivityState, StudyDayReport } from '@/lib/api';
import type { LateStatus } from '@/lib/api';
import { formatDuration, formatSeoulTime } from '@/lib/time';
import { STATE_META, STUDENT_STATE_LABEL, StateBadge } from '@/components/StateBadge';
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
  /** false when the screen renders <DayFacts> elsewhere (the study screen puts it under the timeline). */
  showDayFacts?: boolean;
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
    <span
      data-testid="sync-status"
      data-pending={sync.pendingEvents}
      aria-live="polite"
      className="inline-flex items-center gap-1.5"
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function lateValue(values: LiveValues): string {
  if (values.lateStatus === 'NOT_SEATED') return '미착석';
  if (values.lateSeconds === null) return '—';
  if (values.lateSeconds === 0) return '정시';
  return formatDuration(values.lateSeconds);
}

/** Stopwatch reading: "13:22" under an hour, "1:24:37" after. */
export function clockText(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Soft ambient glow behind the clock, tinted by the current state (static: no animation). */
const GLOW: Record<ActivityState, string> = {
  FOCUS_ESTIMATED: 'bg-emerald-400',
  DISTRACTION_SUSPECTED: 'bg-amber-400',
  AWAY: 'bg-rose-400',
  UNKNOWN: 'bg-slate-400',
  BREAK: 'bg-blue-400',
};

const BREAKDOWN: Array<{
  key: 'awaySeconds' | 'distractionSeconds' | 'unknownSeconds' | 'breakSeconds';
  state: ActivityState;
  label: string;
  testId?: string;
}> = [
  { key: 'awaySeconds', state: 'AWAY', label: '자리 비움', testId: 'away-total' },
  { key: 'distractionSeconds', state: 'DISTRACTION_SUSPECTED', label: '집중 흐트러짐', testId: 'distraction-total' },
  { key: 'breakSeconds', state: 'BREAK', label: '휴식', testId: 'break-total' },
];

/** First seat, lateness and the day's reference time (E2E: first-seated-at, late-seconds). */
export function DayFacts({ values, className = '' }: { values: LiveValues; className?: string }) {
  return (
    <dl className={`flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-slate-500 ${className}`}>
      <div className="flex gap-1.5">
        <dt>첫 착석</dt>
        <dd data-testid="first-seated-at" className="font-semibold text-slate-700 tabular-nums">
          {values.firstSeatedAt ? formatSeoulTime(values.firstSeatedAt) : '아직 없음'}
        </dd>
      </div>
      <div className="flex gap-1.5">
        <dt>지각</dt>
        <dd
          data-testid="late-seconds"
          data-seconds={values.lateSeconds === null ? '' : Math.max(0, Math.floor(values.lateSeconds))}
          className={`font-semibold tabular-nums ${
            values.lateStatus === 'LATE'
              ? 'text-rose-700'
              : values.lateStatus === 'ON_TIME'
                ? 'text-emerald-700'
                : 'text-slate-700'
          }`}
        >
          {lateValue(values)}
        </dd>
      </div>
      <div className="flex gap-1.5">
        <dt>기준</dt>
        <dd className="font-semibold text-slate-700 tabular-nums">{formatSeoulTime(values.referenceTime)}</dd>
      </div>
    </dl>
  );
}

/**
 * Live panel for the student study screen: what's happening now, today's study time as one
 * stopwatch-style number, then a single quiet line of everything else. Durations expose
 * `data-seconds` for E2E.
 */
export function LiveStats({ values, sync, showDayFacts = true, className = '' }: LiveStatsProps) {
  return (
    <section aria-labelledby="live-stats-title" className={`relative isolate text-center ${className}`}>
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute top-10 left-1/2 -z-10 h-72 w-[28rem] max-w-full -translate-x-1/2 rounded-full opacity-[0.07] blur-[100px] transition-colors duration-700 lg:w-[40rem] dark:opacity-[0.06] ${GLOW[values.currentState]}`}
      />
      <h2 id="live-stats-title" className="sr-only">
        오늘의 학습 현황
      </h2>

      <div className="flex flex-col items-center gap-2" aria-live="polite">
        <StateBadge
          testId="current-state"
          state={values.currentState}
          label={STUDENT_STATE_LABEL[values.currentState]}
          size="md"
        />
        <p className="flex flex-wrap items-center justify-center gap-x-2 text-xs font-medium text-slate-500">
          <span>
            {values.hasActiveSession
              ? values.currentStateSince
                ? `${formatSeoulTime(values.currentStateSince)}부터`
                : '방금 시작'
              : '공부 전'}
          </span>
          <span aria-hidden="true">·</span>
          <SyncIndicator sync={sync} />
        </p>
      </div>

      <dl className="mt-10">
        <dt className="text-sm font-semibold text-slate-500">오늘 공부한 시간</dt>
        <dd
          data-testid="focus-total"
          data-seconds={Math.max(0, Math.floor(values.focusSeconds))}
          title={formatDuration(values.focusSeconds)}
          className="mt-1 text-[clamp(4.5rem,22vw,9.5rem)] leading-none font-extrabold tracking-[-0.06em] text-slate-900 tabular-nums lg:text-[clamp(9.5rem,14vw,14rem)]"
        >
          {clockText(values.focusSeconds)}
          <span className="sr-only"> ({formatDuration(values.focusSeconds)})</span>
        </dd>
        <div className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-1 text-sm text-slate-500">
          <div className="flex gap-1.5">
            <dt>지금 연속</dt>
            <dd
              data-testid="current-streak"
              data-seconds={Math.max(0, Math.floor(values.currentStreakSeconds))}
              className="font-semibold text-slate-900 tabular-nums"
            >
              {formatDuration(values.currentStreakSeconds)}
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt>최고 연속</dt>
            <dd
              data-testid="longest-streak"
              data-seconds={Math.max(0, Math.floor(values.longestStreakSeconds))}
              className="font-semibold text-slate-900 tabular-nums"
            >
              {formatDuration(values.longestStreakSeconds)}
            </dd>
          </div>
        </div>
      </dl>

      <dl className="mx-auto mt-10 grid max-w-md grid-cols-3 gap-2 lg:max-w-3xl lg:gap-3">
        {BREAKDOWN.map(({ key, state, label, testId }) => (
          <div key={key} className="rounded-2xl bg-slate-50 px-3 py-3 lg:py-5">
            <dt className="flex items-center justify-center gap-1.5 text-xs font-medium text-slate-500">
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${STATE_META[state].dot}`} />
              {label}
            </dt>
            <dd
              data-testid={testId}
              data-seconds={Math.max(0, Math.floor(values[key]))}
              className="mt-1 text-base font-bold text-slate-900 tabular-nums lg:text-xl"
            >
              {formatDuration(values[key])}
            </dd>
          </div>
        ))}
        {/* Not-measured time is not shown to students; kept as data for E2E/support. */}
        <div hidden>
          <dt>측정 불가</dt>
          <dd data-testid="unknown-total" data-seconds={Math.max(0, Math.floor(values.unknownSeconds))}>
            {formatDuration(values.unknownSeconds)}
          </dd>
        </div>
      </dl>

      {showDayFacts ? <DayFacts values={values} className="mt-4" /> : null}
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
