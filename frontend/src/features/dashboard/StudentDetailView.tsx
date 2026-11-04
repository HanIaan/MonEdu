'use client';
import { memo } from 'react';
import type { ApiError, StudyDayReport } from '@/lib/api';
import { formatDuration, formatSeoulTime } from '@/lib/time';
import { AccessDenied } from '@/components/AccessDenied';
import { ErrorBanner } from '@/components/ErrorBanner';
import { StatCard } from '@/components/StatCard';
import { EmptyState, LoadingState } from '@/components/Skeleton';
import { Timeline, lateStatusText, reasonText } from '@/components/Timeline';

export interface StudentDetailViewProps {
  studentId: string;
  date: string;
  report: StudyDayReport | null;
  loading: boolean;
  error: ApiError | null;
  onRetry: () => void;
  onDateChange: (date: string) => void;
}

function SessionStatusText({ status }: { status: 'ACTIVE' | 'ENDED' }) {
  return status === 'ACTIVE' ? (
    <span className="font-semibold text-emerald-700">진행 중</span>
  ) : (
    <span className="text-slate-600">종료</span>
  );
}

/** Teacher detail view: date-scoped summary, day timeline and session list. */
export const StudentDetailView = memo(function StudentDetailView({
  studentId,
  date,
  report,
  loading,
  error,
  onRetry,
  onDateChange,
}: StudentDetailViewProps) {
  if (error && (error.code === 'STUDENT_NOT_ASSIGNED' || error.status === 403)) {
    return <AccessDenied />;
  }

  return (
    <div data-student-id={studentId} className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xl font-bold text-white"
          >
            {(report?.studentName ?? '학').slice(0, 1)}
          </span>
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
              {report?.studentName ?? '학생'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{date}</p>
          </div>
        </div>
        <div>
          <label htmlFor="detail-date" className="block text-xs font-semibold text-slate-500">
            날짜 선택
          </label>
          <input
            id="detail-date"
            data-testid="date-picker"
            type="date"
            value={date}
            onChange={(event) => {
              if (event.target.value) onDateChange(event.target.value);
            }}
            className="mt-1 h-11 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 focus:border-slate-400 focus:outline-none focus-visible:ring-4 focus-visible:ring-slate-900/5 dark:[color-scheme:dark]"
          />
        </div>
      </div>

      {error ? (
        <ErrorBanner
          title="학습 기록을 불러오지 못했습니다"
          message={
            error.code === 'NETWORK_ERROR' ? '서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.' : error.message
          }
          onRetry={onRetry}
        />
      ) : null}

      {loading && !report ? (
        <div className="rounded-3xl bg-slate-50 p-6">
          <LoadingState label="학습 기록을 불러오는 중…" />
        </div>
      ) : null}

      {report ? (
        <>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatCard
              label="총 집중 추정"
              value={formatDuration(report.totals.focusSeconds)}
              seconds={report.totals.focusSeconds}
              testId="focus-total"
              size="lg"
              className="col-span-2 flex flex-col justify-center md:row-span-2"
            />
            <StatCard
              label="자리비움"
              value={formatDuration(report.totals.awaySeconds)}
              seconds={report.totals.awaySeconds}
              testId="away-total"
              tone="danger"
            />
            <StatCard
              label="비집중 의심"
              value={formatDuration(report.totals.distractionSeconds)}
              seconds={report.totals.distractionSeconds}
              testId="distraction-total"
              tone="warn"
            />
            <StatCard
              label="측정 불가"
              value={formatDuration(report.totals.unknownSeconds)}
              seconds={report.totals.unknownSeconds}
              testId="unknown-total"
              tone="muted"
            />
            <StatCard
              label="최장 연속 집중"
              value={formatDuration(report.longestStreakSeconds)}
              seconds={report.longestStreakSeconds}
              testId="longest-streak"
            />
            <StatCard
              label="첫 착석 / 지각"
              value={report.firstSeatedAt ? formatSeoulTime(report.firstSeatedAt) : '미착석'}
              hint={lateStatusText(report.lateStatus, report.lateSeconds)}
              testId="first-seated-at"
              tone={report.lateStatus === 'LATE' ? 'danger' : 'default'}
            />
          </dl>

          <section aria-labelledby="detail-timeline-title">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h3 id="detail-timeline-title" className="text-lg font-bold text-slate-900">
                시간대별 활동
              </h3>
              <p className="text-xs text-slate-500">구간에 마우스를 올리면 얼마나 이어졌는지 보여요.</p>
            </div>
            <Timeline intervals={report.intervals} computedAt={report.computedAt} />
          </section>

          <section aria-labelledby="detail-sessions-title">
            <h3 id="detail-sessions-title" className="mb-3 text-lg font-bold text-slate-900">
              세션 기록
            </h3>

            {report.sessions.length === 0 ? (
              <div>
                <EmptyState
                  title="이 날짜의 세션이 없습니다"
                  description="학습을 시작하면 세션 기록이 이곳에 표시됩니다."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <caption className="sr-only">세션 기록</caption>
                  <thead>
                    <tr className="text-xs font-semibold text-slate-500">
                      <th scope="col" className="px-4 pb-3">
                        시작
                      </th>
                      <th scope="col" className="px-4 pb-3">
                        종료
                      </th>
                      <th scope="col" className="px-4 pb-3">
                        상태
                      </th>
                      <th scope="col" className="px-4 pb-3">
                        종료 사유
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.sessions.map((session) => (
                      <tr key={session.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-4 font-semibold tabular-nums text-slate-900">
                          {formatSeoulTime(session.startedAt)}
                        </td>
                        <td className="px-4 py-4 font-semibold tabular-nums text-slate-900">
                          {session.endedAt ? formatSeoulTime(session.endedAt) : '—'}
                        </td>
                        <td className="px-4 py-4">
                          <SessionStatusText status={session.status} />
                        </td>
                        <td className="px-4 py-4 text-slate-600">{reasonText(session.endReason)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p className="text-xs leading-relaxed text-slate-500">
            표시된 상태와 시간은 자동 분석에 따른 추정이며, 확인된 사실이나 징계의 근거가 아닙니다. 교사는
            영상·이미지·얼굴 특징값을 볼 수 없습니다.
          </p>
        </>
      ) : null}
    </div>
  );
});
