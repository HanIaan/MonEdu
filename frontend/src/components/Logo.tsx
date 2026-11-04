/**
 * MonEdu brand mark: a progress ring — today's study time filling up — on an ink disc.
 * Ink-coloured, so it inverts with light/dark mode.
 */
export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className={`shrink-0 ${className}`}>
      <circle cx="16" cy="16" r="16" className="fill-slate-900" />
      <circle cx="16" cy="16" r="8.5" fill="none" strokeWidth="3.4" className="stroke-white opacity-25" />
      <path d="M16 7.5a8.5 8.5 0 1 1-8.5 8.5" fill="none" strokeWidth="3.4" strokeLinecap="round" className="stroke-white" />
    </svg>
  );
}

/** Mark + wordmark. */
export function Logo({ markClassName, textClassName = 'text-base' }: { markClassName?: string; textClassName?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark className={markClassName} />
      <span className={`font-bold tracking-[-0.04em] text-slate-900 ${textClassName}`}>MonEdu</span>
    </span>
  );
}
