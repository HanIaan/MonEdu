import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from './Logo';
import { STUDENT_STATE_LABEL, StateBadge } from './StateBadge';

const PRIVACY_LINE = '영상은 브라우저 안에서만 분석되며 서버로 전송되거나 저장되지 않습니다.';

/**
 * Login / sign-up chrome: a quiet brand panel (the study screen's big clock) beside the form on
 * wide screens; form only on phones. Same type, colours and dark mode as the signed-in pages.
 */
export function AuthLayout({
  title,
  lead,
  children,
  wide = false,
}: {
  title: string;
  lead?: ReactNode;
  children: ReactNode;
  /** Wider form column (sign-up has two-column role cards). */
  wide?: boolean;
}) {
  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen flex-col justify-between bg-slate-50 p-12 lg:flex xl:p-16">
        <Link
          href="/login"
          className="w-fit rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-900"
        >
          <Logo markClassName="h-8 w-8" textClassName="text-lg" />
        </Link>
        <div>
          <StateBadge state="FOCUS_ESTIMATED" label={STUDENT_STATE_LABEL.FOCUS_ESTIMATED} size="md" />
          <p
            aria-hidden="true"
            className="mt-4 text-[clamp(5rem,9vw,8.5rem)] leading-none font-extrabold tracking-[-0.06em] text-slate-900 tabular-nums"
          >
            1:24:37
          </p>
          <p className="mt-12 text-4xl font-extrabold tracking-tight text-slate-900 xl:text-5xl">
            켜두고 공부만 하세요.
            <br />
            시간은 MonEdu가 셀게요.
          </p>
          <p className="mt-4 max-w-md text-base text-slate-500">
            AI가 카메라로 자리와 집중 상태를 추정해 오늘 공부한 시간을 자동으로 기록해요.
          </p>
        </div>
        <p className="text-xs text-slate-500">
          {PRIVACY_LINE}{' '}
          <Link href="/privacy" className="font-semibold underline underline-offset-2 hover:text-slate-900">
            개인정보 처리 안내
          </Link>
        </p>
      </aside>

      <main className="flex flex-col justify-center px-5 py-12 sm:px-12">
        <div className={`mx-auto w-full ${wide ? 'max-w-md' : 'max-w-sm'}`}>
          <Link
            href="/login"
            className="mb-12 inline-block rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-900 lg:hidden"
          >
            <Logo markClassName="h-8 w-8" textClassName="text-lg" />
          </Link>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">{title}</h1>
          {lead ? <div className="mt-2 text-base text-slate-500">{lead}</div> : null}
          <div className="mt-8">{children}</div>
          <p className="mt-12 text-xs leading-relaxed text-slate-500 lg:hidden">
            {PRIVACY_LINE}{' '}
            <Link href="/privacy" className="font-semibold underline underline-offset-2 hover:text-slate-900">
              개인정보 처리 안내
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
