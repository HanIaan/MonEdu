import Link from 'next/link';

export function AccessDenied({ backHref = '/teacher', backLabel = '학생 목록으로 돌아가기' }: { backHref?: string; backLabel?: string }) {
  return (
    <div data-testid="access-denied" className="mx-auto max-w-lg rounded-3xl bg-slate-50 px-6 py-14 text-center">
      <span aria-hidden="true" className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-200 text-slate-600">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6">
          <rect x="4.5" y="10" width="15" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" />
        </svg>
      </span>
      <h2 className="mt-4 text-xl font-extrabold tracking-tight text-slate-900">접근 권한이 없습니다</h2>
      <p className="mt-2 text-sm text-slate-500">
        이 학생은 담당 학생으로 배정되어 있지 않습니다. 담당 학생 목록에서 다시 선택해 주세요.
      </p>
      <Link
        href={backHref}
        className="mt-6 inline-flex h-11 items-center rounded-full bg-slate-900 px-6 text-sm font-bold text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
      >
        {backLabel}
      </Link>
    </div>
  );
}
