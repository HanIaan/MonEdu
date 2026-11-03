import type { ReactNode } from 'react';

export interface ErrorBannerProps {
  title?: string;
  message: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  testId?: string;
}

/** role="alert" so assistive tech announces failures and the network state. */
export function ErrorBanner({
  title = '문제가 발생했습니다',
  message,
  onRetry,
  retryLabel = '다시 시도',
  testId,
}: ErrorBannerProps) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className="flex flex-wrap items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
    >
      <span aria-hidden="true" className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-rose-200 text-[10px] font-bold text-rose-800">
        !
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <div className="mt-0.5 text-rose-700">{message}</div>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-rose-300 bg-white px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
