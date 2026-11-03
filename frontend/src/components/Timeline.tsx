import type { ActivityInterval, LateStatus } from '@/lib/api';
import { formatDuration, formatSeoulTime } from '@/lib/time';
import { STATE_META } from '@/components/StateBadge';

export interface TimelineProps {
  /** Ordered intervals (server already sorts by startedAt). */
  intervals: ActivityInterval[];
  /** Reference instant for the open interval's right edge (report.computedAt). */
  computedAt: string;
  className?: string;
}

interface Segment {
  interval: ActivityInterval;
  startMs: number;
  endMs: number;
  leftPct: number;
  widthPct: number;
}

export function lateStatusText(status: LateStatus, lateSeconds?: number | null): string {
  if (status === 'NOT_SEATED') return '미착석';
  if (status === 'ON_TIME') return '정시';
  return `${formatDuration(lateSeconds ?? 0)} 지각`;
}

export function reasonText(reason: string | null | undefined): string {
  switch (reason) {
    case 'SESSION_STARTED':
      return '세션 시작';
    case 'SEATED_CONFIRMED':
      return '착석 확인';
    case 'FOCUS_RESUMED':
      return '집중 재개';
    case 'PRESENCE_LOST':
      return '자리 이탈';
    case 'PHONE_SUSPECTED':
      return '휴대폰 의심';
    case 'LOW_CONFIDENCE':
      return '신뢰도 낮음';
    case 'CAMERA_STOPPED':
      return '카메라 중단';
    case 'CAMERA_PERMISSION_DENIED':
      return '카메라 권한 거부';
    case 'INFERENCE_STALLED':
      return '분석 지연';
    case 'MODEL_ERROR':
      return '모델 오류';
    case 'MONITORING_PAUSED':
      return '모니터링 일시중단';
    case 'BREAK_STARTED':
      return '휴식 시작';
    case 'BREAK_ENDED':
      return '휴식 종료';
    case 'RECONNECTED':
      return '재연결';
    case 'HEARTBEAT_TIMEOUT':
      return '신호 끊김';
    case 'SESSION_ENDED':
      return '학습 종료';
    case 'SESSION_REPLACED':
      return '새 세션으로 교체';
    default:
      return '—';
  }
}

function buildSegments(intervals: ActivityInterval[], computedAtMs: number): { segments: Segment[]; spanStart: number; spanEnd: number } {
  if (intervals.length === 0) return { segments: [], spanStart: 0, spanEnd: 0 };

  const parsed = intervals
    .map((interval) => {
      const startMs = Date.parse(interval.startedAt);
      const rawEnd = interval.endedAt ? Date.parse(interval.endedAt) : computedAtMs;
      const endMs = Number.isFinite(rawEnd) ? Math.max(rawEnd, startMs) : startMs;
      return { interval, startMs, endMs };
    })
    .filter((entry) => Number.isFinite(entry.startMs))
    .sort((a, b) => a.startMs - b.startMs);

  if (parsed.length === 0) return { segments: [], spanStart: 0, spanEnd: 0 };

  const spanStart = parsed[0]!.startMs;
  const spanEnd = Math.max(...parsed.map((entry) => entry.endMs), spanStart);

  const total = Math.max(1, spanEnd - spanStart);
  const segments = parsed.map(({ interval, startMs, endMs }) => ({
    interval,
    startMs,
    endMs,
    leftPct: ((startMs - spanStart) / total) * 100,
    widthPct: ((endMs - startMs) / total) * 100,
  }));

  return { segments, spanStart, spanEnd };
}

function tooltipFor(segment: Segment): string {
  const meta = STATE_META[segment.interval.state];
  const start = formatSeoulTime(segment.interval.startedAt);
  const end = segment.interval.endedAt ? formatSeoulTime(segment.interval.endedAt) : '진행 중';
  const duration = formatDuration(segment.interval.durationSeconds);
  const reason = segment.interval.reason ? ` · ${reasonText(segment.interval.reason)}` : '';
  return `${meta.label} · ${start}–${end} · ${duration}${reason}`;
}

/**
 * Horizontal day timeline. Each segment is a focusable element with a tooltip (hover/focus),
 * and a screen-reader table lists the same intervals. `data-testid` per E2E contract.
 */
export function Timeline({ intervals, computedAt, className = '' }: TimelineProps) {
  const { segments, spanStart, spanEnd } = buildSegments(intervals, Date.parse(computedAt));

  if (segments.length === 0) {
    return (
      <div data-testid="timeline" className={`rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 ${className}`}>
        이 날짜에는 기록된 활동 구간이 없습니다.
      </div>
    );
  }

  return (
    <div className={className}>
      <div data-testid="timeline" role="group" aria-label="시간대별 활동 타임라인">
        <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-slate-600">
          <span>{formatSeoulTime(new Date(spanStart))}</span>
          <span className="text-slate-500">Asia/Seoul (KST)</span>
          <span>{formatSeoulTime(new Date(spanEnd))}</span>
        </div>

        <div className="flex h-12 w-full overflow-hidden rounded-md border border-slate-300 bg-slate-100">
          {segments.map((segment, index) => {
            const meta = STATE_META[segment.interval.state];
            return (
              <div
                key={segment.interval.id}
                className="group relative h-full outline-none"
                style={{ left: 0, width: `${segment.widthPct}%`, minWidth: '2px' }}
              >
                <div
                  data-testid="timeline-segment"
                  data-state={segment.interval.state}
                  data-open={segment.interval.open ? 'true' : 'false'}
                  tabIndex={0}
                  role="img"
                  aria-label={`${tooltipFor(segment)}${segment.interval.open ? ' (진행 중)' : ''}`}
                  className={`h-full w-full cursor-default transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-900 ${meta.segment} ${
                    index === 0 ? '' : 'border-l border-white/60'
                  }`}
                />
                <div
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg group-hover:block group-hover:opacity-100 group-focus-within:block group-focus-within:opacity-100"
                >
                  {tooltipFor(segment)}
                  {segment.interval.open ? ' (진행 중)' : ''}
                </div>
              </div>
            );
          })}
        </div>

        <div data-testid="timeline-legend" className="mt-3">
          <p className="mb-1.5 text-[11px] font-semibold text-slate-500">범례 (색과 함께 상태 이름으로 구분)</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {(Object.keys(STATE_META) as Array<keyof typeof STATE_META>).map((state) => (
              <span key={state} className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                <span aria-hidden="true" className={`h-3 w-3 rounded-sm ring-1 ring-inset ring-slate-900/10 ${STATE_META[state].segment}`} />
                {STATE_META[state].label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <table className="sr-only">
        <caption>시간대별 활동 구간</caption>
        <thead>
          <tr>
            <th scope="col">상태</th>
            <th scope="col">시작 (KST)</th>
            <th scope="col">종료 (KST)</th>
            <th scope="col">소요 시간</th>
          </tr>
        </thead>
        <tbody>
          {segments.map((segment) => (
            <tr key={`sr-${segment.interval.id}`}>
              <td>{STATE_META[segment.interval.state].label}</td>
              <td>{formatSeoulTime(segment.interval.startedAt)}</td>
              <td>{segment.interval.endedAt ? formatSeoulTime(segment.interval.endedAt) : '진행 중'}</td>
              <td>{formatDuration(segment.interval.durationSeconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
