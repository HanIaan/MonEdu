'use client';
import Link from 'next/link';
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

const HEAD =
  'bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500';

function CellLabel({ children }: { children: string }) {
  return <span className="text-xs font-medium text-slate-500 md:hidden">{children}</span>;
}

/** Teacher dashboard: assigned students, live state badges and today's summary. */
export function TeacherStudentsView({ students, loading, error, onRetry }: TeacherStudentsViewProps) {
  if (error) {
    return (
      <ErrorBanner
        title="학생 목록을 불러오지 못했습니다"
        message={error.code === 'NETWORK_ERROR' ? '서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.' : error.message}
        onRetry={onRetry}
      />
    );
  }

  if (loading && !students) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <LoadingState label="담당 학생을 불러오는 중…" />
      </div>
    );
  }

  if (!students || students.length === 0) {
    return (
      <EmptyState
        title="배정된 학생이 없습니다"
        description="관리자에게 담당 학생 배정을 요청해 주세요. 배정되면 이곳에 학생별 현황이 표시됩니다."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <p className="text-sm font-medium text-slate-700">
          담당 학생 <span className="tabular-nums text-slate-500">{students.length}명</span>
        </p>
        <p className="text-xs text-slate-500" aria-live="polite">
          상태는 자동 분석에 따른 추정이며, 실시간으로 갱신됩니다.
        </p>
      </div>

      <table className="block w-full md:table">
        <caption className="sr-only">담당 학생 목록과 오늘의 학습 현황</caption>
        <thead className="hidden md:table-header-group">
          <tr>
            <th scope="col" className={`${HEAD} px-4 py-2.5`}>학생</th>
            <th scope="col" className={`${HEAD} px-4 py-2.5`}>현재 상태</th>
            <th scope="col" className={`${HEAD} px-4 py-2.5`}>첫 착석 / 지각</th>
            <th scope="col" className={`${HEAD} px-4 py-2.5`}>집중 시간</th>
            <th scope="col" className={`${HEAD} px-4 py-2.5`}>자리비움</th>
            <th scope="col" className={`${HEAD} px-4 py-2.5`}>비집중 의심</th>
            <th scope="col" className={`${HEAD} px-4 py-2.5`}>마지막 신호</th>
          </tr>
        </thead>
        <tbody className="block space-y-3 p-3 md:table-row-group md:space-y-0 md:p-0">
          {students.map((overview) => {
            const { student, today } = overview;
            const href = `/teacher/students/${encodeURIComponent(student.id)}`;
            const noSession = !overview.activeSessionId || !overview.currentState;

            return (
              <tr
                key={student.id}
                data-testid="student-row"
                data-student-id={student.id}
                className="block rounded-xl border border-slate-200 bg-white p-4 md:table-row md:rounded-none md:border-0 md:p-0 md:shadow-none"
              >
                <td className="flex items-start justify-between gap-2 pb-2 md:table-cell md:border-t md:border-slate-100 md:px-4 md:py-3">
                  <CellLabel>학생</CellLabel>
                  <div className="text-right md:text-left">
                    <Link
                      href={href}
                      className="text-sm font-semibold text-slate-900 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                    >
                      {student.displayName}
                    </Link>
                    <p className="mt-0.5 hidden text-xs text-slate-500 md:block">{student.email}</p>
                  </div>
                </td>

                <td className="flex items-center justify-between gap-2 py-1.5 md:table-cell md:border-t md:border-slate-100 md:px-4 md:py-3">
                  <CellLabel>현재 상태</CellLabel>
                  <div className="flex flex-col items-end gap-0.5 md:items-start">
                    <StateBadge testId="student-state" state={overview.currentState ?? 'UNKNOWN'} />
                    <span className="text-[11px] text-slate-500">
                      {noSession
                        ? '진행 중인 세션 없음'
                        : overview.currentStateSince
                          ? `${formatSeoulTime(overview.currentStateSince)}부터`
                          : '—'}
                    </span>
                  </div>
                </td>

                <td className="flex items-center justify-between gap-2 py-1.5 md:table-cell md:border-t md:border-slate-100 md:px-4 md:py-3">
                  <CellLabel>첫 착석 / 지각</CellLabel>
                  <div className="text-right md:text-left">
                    <p className="text-sm tabular-nums text-slate-800">
                      {today.firstSeatedAt ? formatSeoulTime(today.firstSeatedAt) : '—'}
                    </p>
                    <p
                      className={`text-[11px] font-medium ${
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

                <td className="flex items-center justify-between gap-2 py-1.5 md:table-cell md:border-t md:border-slate-100 md:px-4 md:py-3">
                  <CellLabel>집중 시간</CellLabel>
                  <span className="text-sm font-medium tabular-nums text-emerald-700">
                    {formatDuration(today.totals.focusSeconds)}
                  </span>
                </td>

                <td className="flex items-center justify-between gap-2 py-1.5 md:table-cell md:border-t md:border-slate-100 md:px-4 md:py-3">
                  <CellLabel>자리비움</CellLabel>
                  <span className="text-sm tabular-nums text-rose-700">{formatDuration(today.totals.awaySeconds)}</span>
                </td>

                <td className="flex items-center justify-between gap-2 py-1.5 md:table-cell md:border-t md:border-slate-100 md:px-4 md:py-3">
                  <CellLabel>비집중 의심</CellLabel>
                  <span className="text-sm tabular-nums text-amber-700">
                    {formatDuration(today.totals.distractionSeconds)}
                  </span>
                </td>

                <td className="flex items-center justify-between gap-2 py-1.5 md:table-cell md:border-t md:border-slate-100 md:px-4 md:py-3">
                  <CellLabel>마지막 신호</CellLabel>
                  <span className="text-sm tabular-nums text-slate-600">
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
}
