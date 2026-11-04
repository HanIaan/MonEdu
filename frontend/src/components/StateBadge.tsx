import type { ActivityState } from '@/lib/api';

export interface StateMeta {
  /** Korean label. Always an estimate/suspicion wording, never a verdict. */
  label: string;
  description: string;
  /** Badge classes (background + text + ring). */
  badge: string;
  /** Small colour dot classes. */
  dot: string;
  /** Solid timeline-segment classes. */
  segment: string;
}

/**
 * State presentation contract (see docs/contracts/state-machine.md §6).
 * Colour is never the only signal: every use pairs these colours with the Korean text label.
 */
export const STATE_META: Record<ActivityState, StateMeta> = {
  FOCUS_ESTIMATED: {
    label: '집중 추정',
    description: '자리에 있고 휴대폰 사용 신호가 없는 상태입니다. 자동 분석에 따른 추정입니다.',
    badge: 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-600/20',
    dot: 'bg-emerald-500',
    segment: 'bg-emerald-500',
  },
  DISTRACTION_SUSPECTED: {
    label: '비집중 의심',
    description: '휴대폰 사용이 의심되는 상태입니다. 확인된 사실이 아닌 자동 추정입니다.',
    badge: 'bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-500/30',
    dot: 'bg-amber-500',
    segment: 'bg-amber-400',
  },
  AWAY: {
    label: '자리비움',
    description: '자리를 비운 것으로 보이는 상태입니다.',
    badge: 'bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-600/20',
    dot: 'bg-rose-400',
    segment: 'bg-rose-400',
  },
  UNKNOWN: {
    label: '측정 불가',
    description: '카메라·모델 문제 등으로 측정할 수 없는 상태입니다.',
    badge: 'border border-dashed border-slate-400 bg-slate-100 text-slate-700',
    dot: 'bg-slate-400',
    segment: 'state-striped bg-slate-200',
  },
  BREAK: {
    label: '휴식',
    description: '학생이 직접 선언한 휴식입니다.',
    badge: 'bg-blue-50 text-blue-800 ring-1 ring-inset ring-blue-600/20',
    dot: 'bg-blue-500',
    segment: 'bg-blue-400',
  },
};

/**
 * Plain wording for the student's own screen (the student reads it at a glance while studying).
 * Teacher views and the contract keep STATE_META labels. Never a verdict, and not tied to one cause (phone, dozing, …).
 */
export const STUDENT_STATE_LABEL: Record<ActivityState, string> = {
  FOCUS_ESTIMATED: '집중하는 중',
  DISTRACTION_SUSPECTED: '집중 흐트러짐',
  AWAY: '자리 비움',
  UNKNOWN: '미측정',
  BREAK: '쉬는 중',
};

export function stateLabel(state: ActivityState | null | undefined): string {
  return state ? STATE_META[state].label : '측정 불가';
}

export function stateDescription(state: ActivityState | null | undefined): string {
  return state ? STATE_META[state].description : STATE_META.UNKNOWN.description;
}

export interface StateBadgeProps {
  state: ActivityState | null | undefined;
  size?: 'sm' | 'md';
  /** data-testid for E2E (e.g. student-state). `data-state` is always emitted. */
  testId?: string;
  /** Overrides the visible label (e.g. STUDENT_STATE_LABEL); colour and pattern stay the same. */
  label?: string;
  className?: string;
}

export function StateBadge({ state, size = 'sm', testId, label, className = '' }: StateBadgeProps) {
  const resolved: ActivityState = state ?? 'UNKNOWN';
  const meta = STATE_META[resolved];
  const sizing = size === 'md' ? 'gap-2 px-3 py-1.5 text-sm' : 'gap-1.5 px-2.5 py-1 text-xs';

  return (
    <span
      data-testid={testId}
      data-state={resolved}
      title={meta.description}
      className={`inline-flex items-center whitespace-nowrap rounded-full font-medium ${sizing} ${meta.badge} ${className}`}
    >
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
      {label ?? meta.label}
      <span className="sr-only"> (자동 추정 상태)</span>
    </span>
  );
}
