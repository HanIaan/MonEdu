import Link from 'next/link';

export function AccessDenied({ backHref = '/teacher', backLabel = '학생 목록으로 돌아가기' }: { backHref?: string; backLabel?: string }) {
  return (
    <div data-testid="access-denied" className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
      <span aria-hidden="true" className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6">
          <rect x="4.5" y="10" width="15" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" />
        </svg>
      </span>
      <h2 className="mt-4 text-lg font-semibold text-slate-900">접근 권한이 없습니다</h2>
      <p className="mt-2 text-sm text-slate-500">
        이 학생은 담당 학생으로 배정되어 있지 않습니다. 담당 학생 목록에서 다시 선택해 주세요.
      </p>
      <Link
        href={backHref}
        className="mt-6 inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
      >
        {backLabel}
      </Link>
    </div>
  );
}
