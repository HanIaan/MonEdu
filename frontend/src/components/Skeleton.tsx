import type { ReactNode } from 'react';

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`animate-spin text-slate-500 ${className}`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function FullPageLoading({ label = '불러오는 중…' }: { label?: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-white px-4">
      <div role="status" className="flex items-center gap-3 text-sm text-slate-600">
        <Spinner className="h-5 w-5" />
        <span>{label}</span>
      </div>
    </div>
  );
}

export function LoadingState({ label = '불러오는 중…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-6 text-sm text-slate-500">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-2xl bg-slate-100 ${className}`} />;
}

/** Skeleton grid used while a dashboard report loads. */
export function CardSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div role="status" aria-label="불러오는 중" className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-24" />
      ))}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="rounded-3xl bg-slate-50 px-6 py-14 text-center">
      <p className="text-base font-bold text-slate-900">{title}</p>
      {description ? <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
