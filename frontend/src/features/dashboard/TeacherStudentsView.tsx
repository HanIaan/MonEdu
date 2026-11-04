'use client';
import Link from 'next/link';
import { memo } from 'react';
import type { ApiError, TeacherStudentOverview } from '@/lib/api';
import { formatDuration, formatSeoulTime } from '@/lib/time';
import { StateBadge } from '@/components/StateBadge';
import { ErrorBanner } from '@/components/ErrorBanner';
import { EmptyState, LoadingState } from '@/components/Skeleton';
import { lateStatusText } from '@/components/Timeline';

export interface TeacherStudentsViewProps {
  students: TeacherStudentOverview[] | null;
  loading: boolean;
  error: ApiError | null;
  onRetry: () => void;
}

const HEAD = 'text-left text-xs font-semibold text-slate-500';

function CellLabel({ children }: { children: string }) {
  return <span className="text-xs font-medium text-slate-500 md:hidden">{children}</span>;
}

/** Teacher dashboard: assigned students, live state badges and today's summary. */
export const TeacherStudentsView = memo(function TeacherStudentsView({
  students,
  loading,
  error,
  onRetry,
}: TeacherStudentsViewProps) {
  if (error) {
    return (
      <ErrorBanner
        title="학생 목록을 불러오지 못했습니다"
        message={
          error.code === 'NETWORK_ERROR' ? '서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.' : error.message
        }
        onRetry={onRetry}
      />
    );
  }

  if (loading && !students) {
    return (
      <div className="rounded-3xl bg-slate-50 p-6">
        <LoadingState label="담당 학생을 불러오는 중…" />
      </div>
    );
  }

  if (!students || students.length === 0) {
    return (
      <EmptyState
        title="배정된 학생이 없습니다"
        description="위의 초대 코드를 학생에게 알려 주세요. 학생이 가입 후 이 코드를 입력하면 이곳에 연결됩니다."
      />
    );
  }

  const studying = students.filter((overview) => overview.activeSessionId).length;
  const focusing = students.filter(
    (overview) => overview.activeSessionId && overview.currentState === 'FOCUS_ESTIMATED',
  ).length;
  const cell =
    'flex items-center justify-between gap-2 py-1.5 md:table-cell md:border-t md:border-slate-100 md:px-4 md:py-4';

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-3 gap-2 sm:gap-3" aria-live="polite">
        {[
          { label: '담당 학생', value: students.length },
          { label: '지금 공부 중', value: studying },
          { label: '집중 추정', value: focusing },
        ].map((item) => (
          <div key={item.label} className="rounded-3xl bg-slate-50 px-4 py-5 sm:px-6">
            <dt className="text-xs font-semibold text-slate-500 sm:text-sm">{item.label}</dt>
            <dd className="mt-1 text-3xl font-extrabold tracking-tight text-slate-900 tabular-nums sm:text-4xl">
              {item.value}
              <span className="ml-0.5 text-base font-bold text-slate-400">명</span>
            </dd>
          </div>
        ))}
      </dl>

      <table className="block w-full md:table">
        <caption className="sr-only">담당 학생 목록과 오늘의 학습 현황</caption>
        <thead className="hidden md:table-header-group">
          <tr>
            <th scope="col" className={`${HEAD} px-4 pb-3`}>
              학생
            </th>
            <th scope="col" className={`${HEAD} px-4 pb-3`}>
              현재 상태
            </th>
            <th scope="col" className={`${HEAD} px-4 pb-3`}>
              집중 시간
            </th>
            <th scope="col" className={`${HEAD} px-4 pb-3`}>
              첫 착석 / 지각
            </th>
            <th scope="col" className={`${HEAD} px-4 pb-3`}>
              자리비움
            </th>
            <th scope="col" className={`${HEAD} px-4 pb-3`}>
              비집중 의심
            </th>
            <th scope="col" className={`${HEAD} px-4 pb-3`}>
              마지막 신호
            </th>
          </tr>
        </thead>
        <tbody className="block space-y-3 md:table-row-group md:space-y-0">
          {students.map((overview) => {
            const { student, today } = overview;
            const href = `/teacher/students/${encodeURIComponent(student.id)}`;
            const noSession = !overview.activeSessionId || !overview.currentState;

            return (
              <tr
                key={student.id}
                data-testid="student-row"
                data-student-id={student.id}
                className="block rounded-3xl bg-slate-50 p-5 transition-colors md:table-row md:rounded-none md:bg-transparent md:p-0 md:hover:bg-slate-50"
              >
                <td className="flex items-center justify-between gap-2 pb-3 md:table-cell md:border-t md:border-slate-100 md:px-4 md:py-4">
                  <CellLabel>학생</CellLabel>
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-sm font-bold text-slate-700 md:flex"
                    >
                      {student.displayName.slice(0, 1)}
                    </span>
                    <div className="text-right md:text-left">
                      <Link
                        href={href}
                        className="text-base font-bold text-slate-900 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                      >
                        {student.displayName}
                      </Link>
                      <p className="mt-0.5 hidden text-xs text-slate-500 md:block">{student.email ?? '카카오 계정'}</p>
                    </div>
                  </div>
                </td>

                <td className={cell}>
                  <CellLabel>현재 상태</CellLabel>
                  <div className="flex flex-col items-end gap-1 md:items-start">
                    <StateBadge testId="student-state" state={overview.currentState ?? 'UNKNOWN'} />
                    <span className="text-xs text-slate-500">
                      {noSession
                        ? '진행 중인 세션 없음'
                        : overview.currentStateSince
                          ? `${formatSeoulTime(overview.currentStateSince)}부터`
                          : '—'}
                    </span>
                  </div>
                </td>

                <td className={cell}>
                  <CellLabel>집중 시간</CellLabel>
                  <span className="text-lg font-extrabold tracking-tight text-slate-900 tabular-nums">
                    {formatDuration(today.totals.focusSeconds)}
                  </span>
                </td>

                <td className={cell}>
                  <CellLabel>첫 착석 / 지각</CellLabel>
                  <div className="text-right md:text-left">
                    <p className="text-sm font-semibold tabular-nums text-slate-800">
                      {today.firstSeatedAt ? formatSeoulTime(today.firstSeatedAt) : '—'}
                    </p>
                    <p
                      className={`text-xs font-semibold ${
                        today.lateStatus === 'LATE'
                          ? 'text-rose-700'
                          : today.lateStatus === 'ON_TIME'
                            ? 'text-emerald-700'
                            : 'text-slate-500'
                      }`}
                    >
                      {lateStatusText(today.lateStatus, today.lateSeconds)}
                    </p>
                  </div>
                </td>

                <td className={cell}>
                  <CellLabel>자리비움</CellLabel>
                  <span className="text-sm font-semibold tabular-nums text-slate-700">
                    {formatDuration(today.totals.awaySeconds)}
                  </span>
                </td>

                <td className={cell}>
                  <CellLabel>비집중 의심</CellLabel>
                  <span className="text-sm font-semibold tabular-nums text-slate-700">
                    {formatDuration(today.totals.distractionSeconds)}
                  </span>
                </td>

                <td className={cell}>
                  <CellLabel>마지막 신호</CellLabel>
                  <span className="text-sm tabular-nums text-slate-500">
                    {overview.lastHeartbeatAt ? formatSeoulTime(overview.lastHeartbeatAt) : '—'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});
