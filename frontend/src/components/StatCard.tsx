import { memo, type ReactNode } from 'react';

export type StatTone = 'default' | 'focus' | 'warn' | 'danger' | 'muted' | 'info';

const TONE_VALUE: Record<StatTone, string> = {
  default: 'text-slate-900',
  focus: 'text-emerald-700',
  warn: 'text-amber-700',
  danger: 'text-rose-700',
  muted: 'text-slate-600',
  info: 'text-blue-700',
};

export interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: StatTone;
  /** data-testid for E2E. */
  testId?: string;
  /**
   * When defined, emits `data-seconds` with the raw floor value (empty string for null).
   * Used by the E2E contract for duration/lateness cards.
   */
  seconds?: number | null;
  /** `lg` emphasises the primary metric (e.g. today's focus total). */
  size?: 'md' | 'lg';
  className?: string;
}

/** Leaf card; memoised so dashboard snapshot/table re-renders do not re-render the stats. */
export const StatCard = memo(function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  testId,
  seconds,
  size = 'md',
  className = '',
}: StatCardProps) {
  const hasSeconds = seconds !== undefined;
  const valueSize = size === 'lg' ? 'text-4xl sm:text-5xl font-extrabold' : 'text-xl font-bold';
  return (
    <div className={`rounded-3xl bg-slate-50 px-5 py-4 ${className}`}>
      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
      <dd
        data-testid={testId}
        data-seconds={hasSeconds ? (seconds === null ? '' : Math.max(0, Math.floor(seconds))) : undefined}
        className={`mt-1 ${valueSize} tabular-nums tracking-tight ${TONE_VALUE[tone]}`}
      >
        {value}
      </dd>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
});
