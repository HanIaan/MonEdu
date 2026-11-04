import type { ActivityInterval, ActivityState, LateStatus } from '@/lib/api';
import { formatDuration, formatSeoulTime } from '@/lib/time';
import { STATE_META } from '@/components/StateBadge';

export interface TimelineProps {
  /** Ordered intervals (server already sorts by startedAt). */
  intervals: ActivityInterval[];
  /** Reference instant for the open interval's right edge (report.computedAt). */
  computedAt: string;
  /** Overrides the state labels in the legend and tooltips (e.g. STUDENT_STATE_LABEL). */
  labels?: Record<ActivityState, string>;
  /**
   * Draw time with no recorded interval (between sessions) as "not measured" too, so the bar reads
   * as one continuous day. Off by default: the teacher view keeps gaps visible.
   */
  fillGaps?: boolean;
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

interface Gap {
  startMs: number;
  endMs: number;
  leftPct: number;
  widthPct: number;
}

/** Stretches of at least a second that no interval covers. */
function findGaps(segments: Segment[], spanStart: number, spanEnd: number): Gap[] {
  const total = Math.max(1, spanEnd - spanStart);
  const gaps: Gap[] = [];
  let coveredUntil = spanStart;
  for (const segment of segments) {
    if (segment.startMs - coveredUntil >= 1000) {
      gaps.push({
        startMs: coveredUntil,
        endMs: segment.startMs,
        leftPct: ((coveredUntil - spanStart) / total) * 100,
        widthPct: ((segment.startMs - coveredUntil) / total) * 100,
      });
    }
    coveredUntil = Math.max(coveredUntil, segment.endMs);
  }
  return gaps;
}

function tooltipAnchor(leftPct: number, widthPct: number): string {
  const center = leftPct + widthPct / 2;
  return center < 18 ? 'left-0' : center > 82 ? 'right-0' : 'left-1/2 -translate-x-1/2';
}

function Tooltip({ anchor, duration, dot, text }: { anchor: string; duration: string; dot: string; text: string }) {
  return (
    <div
      role="tooltip"
      className={`pointer-events-none absolute bottom-full z-20 mb-2 hidden whitespace-nowrap rounded-2xl bg-slate-900 px-3.5 py-2 text-left text-white shadow-lg group-hover:block group-focus-within:block ${anchor}`}
    >
      <span className="block text-base font-bold tabular-nums">{duration}</span>
      <span className="mt-0.5 flex items-center gap-1.5 text-xs font-medium opacity-80">
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {text}
      </span>
    </div>
  );
}

function tooltipFor(segment: Segment, labels?: Record<ActivityState, string>): string {
  const label = labels?.[segment.interval.state] ?? STATE_META[segment.interval.state].label;
  const start = formatSeoulTime(segment.interval.startedAt);
  const end = segment.interval.endedAt ? formatSeoulTime(segment.interval.endedAt) : '진행 중';
  const duration = formatDuration(segment.interval.durationSeconds);
  const reason = segment.interval.reason ? ` · ${reasonText(segment.interval.reason)}` : '';
  return `${label} · ${start}–${end} · ${duration}${reason}`;
}

/**
 * Horizontal day timeline. Each segment is a focusable element with a tooltip (hover/focus),
 * and a screen-reader table lists the same intervals. `data-testid` per E2E contract.
 */
export function Timeline({ intervals, computedAt, labels, fillGaps = false, className = '' }: TimelineProps) {
  const { segments, spanStart, spanEnd } = buildSegments(intervals, Date.parse(computedAt));
  const gaps = fillGaps ? findGaps(segments, spanStart, spanEnd) : [];
  const unknownLabel = labels?.UNKNOWN ?? STATE_META.UNKNOWN.label;

  if (segments.length === 0) {
    return (
      <div data-testid="timeline" className={`rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-400 ${className}`}>
        이 날짜에는 기록된 활동 구간이 없습니다.
      </div>
    );
  }

  return (
    <div className={className}>
      <div data-testid="timeline" role="group" aria-label="시간대별 활동 타임라인">
        <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-slate-500 tabular-nums">
          <span>{formatSeoulTime(new Date(spanStart))}</span>
          <span className="sr-only">Asia/Seoul (KST)</span>
          <span>{formatSeoulTime(new Date(spanEnd))}</span>
        </div>

        {/*
          Square segments placed at their real clock position (gaps between sessions stay visible).
          No overflow clipping, so the hover/focus tooltip can rise above the bar.
        */}
        {/*
          With fillGaps the not-measured stripes are one continuous track under the bar (no seams
          where separate elements would restart the pattern); measured states sit on top of it.
        */}
        <div className={`relative h-10 w-full ${fillGaps ? STATE_META.UNKNOWN.segment : 'bg-slate-100'}`}>
          {gaps.map((gap) => {
            const text = `${unknownLabel} (기록 없음) · ${formatSeoulTime(new Date(gap.startMs))}–${formatSeoulTime(new Date(gap.endMs))}`;
            const duration = formatDuration((gap.endMs - gap.startMs) / 1000);
            return (
              <div
                key={`gap-${gap.startMs}`}
                className="group absolute top-0 h-full outline-none"
                style={{ left: `${gap.leftPct}%`, width: `${gap.widthPct}%` }}
              >
                <div
                  data-testid="timeline-gap"
                  tabIndex={0}
                  role="img"
                  aria-label={`${text} · ${duration}`}
                  className="h-full w-full cursor-default transition-colors group-hover:bg-slate-900/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-900"
                />
                <Tooltip
                  anchor={tooltipAnchor(gap.leftPct, gap.widthPct)}
                  duration={duration}
                  dot={STATE_META.UNKNOWN.dot}
                  text={text}
                />
              </div>
            );
          })}
          {segments.map((segment, index) => {
            const meta = STATE_META[segment.interval.state];
            const label = labels?.[segment.interval.state] ?? meta.label;
            // Over the striped track, not-measured intervals are transparent hit areas for the tooltip.
            const onTrack = fillGaps && segment.interval.state === 'UNKNOWN';
            // A divider only where it is visible; on slivers or over the stripes it reads as a stray line.
            const divider = !fillGaps && index > 0 && segment.widthPct >= 0.6;
            return (
              <div
                key={segment.interval.id}
                className="group absolute top-0 h-full outline-none"
                style={{ left: `${segment.leftPct}%`, width: `${segment.widthPct}%`, minWidth: '2px' }}
              >
                <div
                  data-testid="timeline-segment"
                  data-state={segment.interval.state}
                  data-open={segment.interval.open ? 'true' : 'false'}
                  tabIndex={0}
                  role="img"
                  aria-label={`${tooltipFor(segment, labels)}${segment.interval.open ? ' (진행 중)' : ''}`}
                  className={`h-full w-full cursor-default transition-opacity focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-900 ${
                    onTrack ? 'transition-colors group-hover:bg-slate-900/10' : `group-hover:opacity-80 ${meta.segment}`
                  } ${divider ? 'border-l-2 border-white' : ''}`}
                />
                <Tooltip
                  anchor={tooltipAnchor(segment.leftPct, segment.widthPct)}
                  duration={formatDuration(segment.interval.durationSeconds)}
                  dot={meta.dot}
                  text={`${label} · ${formatSeoulTime(segment.interval.startedAt)}–${
                    segment.interval.endedAt ? formatSeoulTime(segment.interval.endedAt) : '지금'
                  }`}
                />
              </div>
            );
          })}
        </div>

        <div data-testid="timeline-legend" className="mt-4">
          <p className="sr-only">범례 (색과 함께 상태 이름으로 구분)</p>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            {(Object.keys(STATE_META) as Array<keyof typeof STATE_META>).map((state) => (
              <span key={state} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <span aria-hidden="true" className={`h-2.5 w-2.5 ${STATE_META[state].segment}`} />
                {labels?.[state] ?? STATE_META[state].label}
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
              <td>{labels?.[segment.interval.state] ?? STATE_META[segment.interval.state].label}</td>
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
