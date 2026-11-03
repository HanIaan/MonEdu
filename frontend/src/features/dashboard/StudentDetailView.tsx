'use client';
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
    <span className="font-medium text-emerald-700">진행 중</span>
  ) : (
    <span className="text-slate-600">종료</span>
  );
}

/** Teacher detail view: date-scoped summary, day timeline and session list. */
export function StudentDetailView({
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
    <div data-student-id={studentId} className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">학생 상세</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
            {report?.studentName ?? '학생'}
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">{date} (Asia/Seoul)</p>
        </div>
        <div>
          <label htmlFor="detail-date" className="block text-xs font-medium text-slate-500">
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
            className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20"
          />
        </div>
      </div>

      {error ? (
        <ErrorBanner
          title="학습 기록을 불러오지 못했습니다"
          message={error.code === 'NETWORK_ERROR' ? '서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.' : error.message}
          onRetry={onRetry}
        />
      ) : null}

      {loading && !report ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <LoadingState label="학습 기록을 불러오는 중…" />
        </div>
      ) : null}

      {report ? (
        <>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard
              label="총 집중 추정"
              value={formatDuration(report.totals.focusSeconds)}
              seconds={report.totals.focusSeconds}
              testId="focus-total"
              tone="focus"
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

          <section aria-labelledby="detail-timeline-title" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 id="detail-timeline-title" className="text-sm font-semibold text-slate-900">
                시간대별 활동 타임라인
              </h3>
              <p className="text-xs text-slate-500">구간에 마우스를 올리거나 키보드로 포커스하면 상세가 표시됩니다.</p>
            </div>
            <Timeline intervals={report.intervals} computedAt={report.computedAt} />
          </section>

          <section aria-labelledby="detail-sessions-title" className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
              <h3 id="detail-sessions-title" className="text-sm font-semibold text-slate-900">
                세션 기록
              </h3>
            </div>

            {report.sessions.length === 0 ? (
              <div className="p-4">
                <EmptyState title="이 날짜의 세션이 없습니다" description="학습을 시작하면 세션 기록이 이곳에 표시됩니다." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <caption className="sr-only">세션 기록</caption>
                  <thead>
                    <tr className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th scope="col" className="px-4 py-2.5">시작 (KST)</th>
                      <th scope="col" className="px-4 py-2.5">종료 (KST)</th>
                      <th scope="col" className="px-4 py-2.5">상태</th>
                      <th scope="col" className="px-4 py-2.5">종료 사유</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.sessions.map((session) => (
                      <tr key={session.id} className="border-t border-slate-100">
                        <td className="px-4 py-3 tabular-nums text-slate-800">{formatSeoulTime(session.startedAt)}</td>
                        <td className="px-4 py-3 tabular-nums text-slate-800">
                          {session.endedAt ? formatSeoulTime(session.endedAt) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <SessionStatusText status={session.status} />
                        </td>
                        <td className="px-4 py-3 text-slate-600">{reasonText(session.endReason)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p className="text-[11px] leading-relaxed text-slate-500">
            표시된 상태와 시간은 자동 분석에 따른 추정이며, 확인된 사실이나 징계의 근거가 아닙니다. 교사는
            영상·이미지·얼굴 특징값을 볼 수 없습니다.
          </p>
        </>
      ) : null}
    </div>
  );
}
